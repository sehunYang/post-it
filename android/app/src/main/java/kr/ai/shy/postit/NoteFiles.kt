package kr.ai.shy.postit

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import androidx.core.graphics.createBitmap
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 글에 붙은 파일 하나. 본체는 Storage 의 [path] 에 있습니다(docs/FILES.md).
 * 이미지인지는 [type] 으로만 판단합니다.
 */
data class NoteFile(
    val path: String,
    val name: String,
    val type: String,
    val size: Long
) {
    val isImage: Boolean get() = type.startsWith("image/")
}

/** 올리기 전에 ContentResolver 로 알아낸 파일 정보. [size] 를 모르면 -1. */
data class PickedFile(
    val uri: Uri,
    val name: String,
    val type: String,
    val size: Long
)

/**
 * 사진·파일 공유에 필요한 기기 쪽 일들을 모아 둡니다.
 *
 * - 고른 파일의 이름·크기·종류 읽기, 이름 다듬기, 미리보기(thumb) 만들기
 * - 받은 파일을 cacheDir/received/{noteId}/{i}/{name} 에 받아 두기
 * - FileProvider 주소로 바꿔 클립보드·공유에 넘기기
 *
 * 서버에 쓰는 순서는 [Repo.addFileNote] 에 있습니다.
 */
object NoteFiles {

    /** 글 하나에 붙일 수 있는 파일 수 (규칙 언어로는 셀 수 없어 클라이언트가 지킵니다) */
    const val MAX_FILES = 10

    /** 미리보기 긴 변 / JPEG 품질 / data URL 최대 길이 */
    private const val THUMB_SIDE = 320
    private const val THUMB_QUALITY = 70
    private const val THUMB_MAX_CHARS = 60_000
    private const val THUMB_PREFIX = "data:image/jpeg;base64,"

    private const val NAME_MAX = 200
    private const val RECEIVED_DIR = "received"

    /** 받아 둔 글 폴더를 몇 개까지 남길지. 오래된 것부터 지웁니다. */
    private const val KEEP_RECEIVED = 20

    /** 오프라인일 때 Storage 가 기본 10분까지 재시도하므로 짧게 줄입니다. */
    private const val DOWNLOAD_RETRY_MS = 20_000L
    private const val UPLOAD_RETRY_MS = 60_000L
    private const val OPERATION_RETRY_MS = 20_000L

    val storage: FirebaseStorage by lazy {
        FirebaseStorage.getInstance().apply {
            maxDownloadRetryTimeMillis = DOWNLOAD_RETRY_MS
            maxUploadRetryTimeMillis = UPLOAD_RETRY_MS
            maxOperationRetryTimeMillis = OPERATION_RETRY_MS
        }
    }

    fun authority(context: Context): String = context.packageName + ".files"

    /* ---------- 이름 다듬기 (모든 클라이언트 공통 규칙) ---------- */

    private val BAD_CHARS = Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]")

    /**
     * docs/FILES.md 의 "파일 이름 다듬기" 1~4번.
     * 금지 문자 → `_`, 앞뒤 공백·마침표 제거, 200자 넘으면 확장자를 살려 앞부분만, 비면 `file`.
     */
    fun sanitizeName(raw: String): String {
        var name = raw.replace(BAD_CHARS, "_")
            .trim { it.isWhitespace() || it == '.' }

        if (name.length > NAME_MAX) {
            val dot = name.lastIndexOf('.')
            val ext = if (dot > 0 && name.length - dot <= 16) name.substring(dot) else ""
            name = cutChars(name.substring(0, name.length - ext.length), NAME_MAX - ext.length) + ext
            name = name.trim { it.isWhitespace() || it == '.' }
        }
        return name.ifEmpty { "file" }
    }

    /** 서로게이트 쌍(이모지 등)을 반으로 자르지 않도록 [max] 글자까지 남깁니다. */
    private fun cutChars(s: String, max: Int): String {
        if (s.length <= max) return s
        var end = max
        if (end > 0 && Character.isHighSurrogate(s[end - 1])) end--
        return s.substring(0, end)
    }

    /** 5번 규칙 — 이름 없는 이미지(붙여넣은 스크린샷 등): `이미지-YYYYMMDD-HHMMSS.png` (로컬 시각) */
    private fun unnamedImageName(type: String): String {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(type)
            ?.takeIf { type != "image/png" }
            ?: "png"
        return "이미지-$stamp.$ext"
    }

    /** 위젯 등 좁은 곳에 쓰는 한 줄 요약. "🖼 스크린샷.png" 또는 "파일 3개 · 보고서.pdf 외 2개" */
    fun summary(context: Context, files: List<NoteFile>): String {
        val first = files.firstOrNull() ?: return ""
        return when {
            files.size > 1 -> context.getString(R.string.files_many, files.size, first.name, files.size - 1)
            first.isImage -> context.getString(R.string.files_image_one, first.name)
            else -> context.getString(R.string.files_file_one, first.name)
        }
    }

    /* ---------- 고른 파일 읽기 ---------- */

    /**
     * 파일 이름·크기·종류를 읽습니다. 이름을 못 얻으면 [fallbackName] → 이미지면 `이미지-…` → `file`.
     * 크기를 모르면 -1 을 돌려주고, 올릴 때 실제로 읽으며 확인합니다.
     */
    fun describe(context: Context, uri: Uri, fallbackName: String?): PickedFile {
        val resolver = context.contentResolver
        var name: String? = null
        var size = -1L

        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val s = c.getColumnIndex(OpenableColumns.SIZE)
                        if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                        if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                    }
                }
        }
        if (size < 0) {
            size = runCatching {
                resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
            }.getOrNull() ?: -1L
        }

        val type = resolver.getType(uri)
            ?: name?.substringAfterLast('.', "")?.lowercase()
                ?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
            ?: "application/octet-stream"

        val chosen = name?.takeIf { it.isNotBlank() }
            ?: fallbackName?.takeIf { it.isNotBlank() }
            ?: if (type.startsWith("image/")) unnamedImageName(type) else "file"

        return PickedFile(uri, sanitizeName(chosen), type, size)
    }

    /* ---------- 미리보기 ---------- */

    /**
     * 첫 번째 이미지로 미리보기 data URL 을 만듭니다.
     * 긴 변 320px, JPEG 70%. 60,000자를 넘으면 품질을 낮춰 보고, 그래도 넘거나 못 읽으면 null.
     */
    suspend fun makeThumb(context: Context, uri: Uri): String? = withContext(Dispatchers.IO) {
        runCatching {
            val decoded = decodeSmall(context, uri) ?: return@runCatching null
            val scaled = fitOnWhite(decoded, THUMB_SIDE)
            if (scaled !== decoded) decoded.recycle()

            var result: String? = null
            for (quality in intArrayOf(THUMB_QUALITY, 50, 30)) {
                val out = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                val url = THUMB_PREFIX + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                if (url.length <= THUMB_MAX_CHARS) {
                    result = url
                    break
                }
            }
            scaled.recycle()
            result
        }.getOrNull()
    }

    /**
     * 긴 변이 320px 이상 남는 선에서 크게 줄여 읽습니다.
     * Android 9 이상은 ImageDecoder 가 사진의 회전(EXIF)까지 맞춰 주고, 그 아래는 inSampleSize 로 읽습니다.
     */
    private fun decodeSmall(context: Context, uri: Uri): Bitmap? {
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(resolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetSampleSize(sampleSize(info.size.width, info.size.height))
            }
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
        }
        return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    }

    /** 긴 변이 [THUMB_SIDE] 아래로 내려가지 않는 가장 큰 2의 거듭제곱 */
    private fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        val longest = max(width, height)
        while (longest / (sample * 2) >= THUMB_SIDE) sample *= 2
        return sample
    }

    /** 긴 변을 [side] 에 맞추고 흰 바탕에 그립니다. (투명한 PNG 가 JPEG 에서 검게 나오지 않게) */
    private fun fitOnWhite(src: Bitmap, side: Int): Bitmap {
        val longest = max(src.width, src.height)
        val scale = if (longest > side) side.toFloat() / longest else 1f
        val w = max(1, (src.width * scale).roundToInt())
        val h = max(1, (src.height * scale).roundToInt())

        val out = createBitmap(w, h)
        out.eraseColor(Color.WHITE)
        Canvas(out).drawBitmap(src, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
        return out
    }

    /**
     * 미리보기 data URL 을 화면용 비트맵으로 풉니다.
     * [maxSide] 보다 크면 inSampleSize 로 줄여 읽습니다. (위젯 RemoteViews 는 작게 보내야 합니다)
     */
    fun decodeThumb(thumb: String?, maxSide: Int): Bitmap? {
        if (thumb.isNullOrEmpty() || !thumb.startsWith("data:image/")) return null
        return runCatching {
            val bytes = Base64.decode(thumb.substringAfter(','), Base64.DEFAULT)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
                inSampleSize = sample
            })
        }.getOrNull()
    }

    /* ---------- 받은 파일 (기기 캐시) ---------- */

    private fun receivedRoot(context: Context) = File(context.cacheDir, RECEIVED_DIR)

    private fun noteDir(context: Context, noteId: String) =
        File(receivedRoot(context), sanitizeName(noteId))

    private fun localFile(context: Context, noteId: String, index: Int, file: NoteFile) =
        File(File(noteDir(context, noteId), index.toString()), sanitizeName(file.name))

    /** 이미 같은 크기로 받아 둔 파일이면 다시 받지 않습니다. */
    private fun isCached(local: File, file: NoteFile) =
        local.isFile && local.length() == file.size

    /** 모두 받아 둔 상태면 그 파일들을, 하나라도 없으면 null. (오프라인일 때 씁니다) */
    fun cached(context: Context, noteId: String, files: List<NoteFile>): List<File>? {
        val locals = files.mapIndexed { i, f -> localFile(context, noteId, i, f) }
        return if (files.isNotEmpty() && locals.zip(files).all { (l, f) -> isCached(l, f) }) locals else null
    }

    /**
     * 글의 파일들을 cacheDir/received/{noteId}/{i}/{name} 에 받아 두고 그 파일들을 돌려줍니다.
     * 같은 크기로 이미 있으면 건너뛰고, 끝나면 오래된 글 폴더를 정리합니다.
     */
    suspend fun download(context: Context, noteId: String, files: List<NoteFile>): List<File> {
        val locals = ArrayList<File>(files.size)
        for ((i, file) in files.withIndex()) {
            val local = localFile(context, noteId, i, file)
            if (!isCached(local, file)) {
                withContext(Dispatchers.IO) { local.parentFile?.mkdirs() }
                val partial = File(local.parentFile, local.name + ".part")
                try {
                    storage.reference.child(file.path).getFile(partial).await()
                    withContext(Dispatchers.IO) {
                        local.delete()
                        if (!partial.renameTo(local)) throw IOException("파일을 저장하지 못했습니다.")
                    }
                } finally {
                    withContext(Dispatchers.IO) { partial.delete() }
                }
            }
            locals += local
        }
        withContext(Dispatchers.IO) {
            noteDir(context, noteId).setLastModified(System.currentTimeMillis())
            prune(context)
        }
        return locals
    }

    /** 최근에 쓴 [KEEP_RECEIVED] 개 글 폴더만 남깁니다. */
    private fun prune(context: Context) {
        val dirs = receivedRoot(context).listFiles()?.filter { it.isDirectory } ?: return
        dirs.sortedByDescending { it.lastModified() }
            .drop(KEEP_RECEIVED)
            .forEach { it.deleteRecursively() }
    }

    /** 지운 글의 받아 둔 파일도 함께 치웁니다. */
    fun forget(context: Context, noteId: String) {
        runCatching { noteDir(context, noteId).deleteRecursively() }
    }

    /* ---------- 클립보드 · 공유 ---------- */

    fun contentUris(context: Context, locals: List<File>): List<Uri> =
        locals.map { FileProvider.getUriForFile(context, authority(context), it) }

    /**
     * content:// 주소들로 클립을 만듭니다. 첫 항목은 newUri, 나머지는 addItem 으로 붙여
     * 설명(ClipDescription)에 모든 파일의 MIME 종류가 들어가게 합니다.
     * 클립보드가 붙여넣는 앱에 읽기 권한을 넘겨 줍니다(provider 의 grantUriPermissions).
     */
    fun clipOf(context: Context, label: String, uris: List<Uri>): ClipData {
        val resolver = context.contentResolver
        val clip = ClipData.newUri(resolver, label, uris.first())
        for (uri in uris.drop(1)) clip.addItem(resolver, ClipData.Item(uri))
        return clip
    }

    /** 공유 시트에 넘길 인텐트. 하나면 SEND, 여럿이면 SEND_MULTIPLE. */
    fun shareIntent(context: Context, label: String, files: List<NoteFile>, uris: List<Uri>): Intent {
        val intent = if (uris.size == 1) {
            Intent(Intent.ACTION_SEND).apply {
                type = files.first().type
                putExtra(Intent.EXTRA_STREAM, uris.first())
            }
        } else {
            Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = commonType(files)
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
            }
        }
        // 받는 앱이 읽을 수 있도록 ClipData 에도 넣고 읽기 권한을 붙입니다.
        intent.clipData = clipOf(context, label, uris)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return intent
    }

    /** 모두 같은 종류면 그 종류, 같은 계열(image/…)이면 `image/*`, 아니면 `*/*`. */
    private fun commonType(files: List<NoteFile>): String {
        val types = files.map { it.type }.distinct()
        if (types.size == 1) return types.first()
        val families = types.map { it.substringBefore('/') }.distinct()
        return if (families.size == 1) families.first() + "/*" else "*/*"
    }
}
