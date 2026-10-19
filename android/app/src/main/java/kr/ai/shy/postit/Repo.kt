package kr.ai.shy.postit

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import com.google.firebase.storage.StorageMetadata
import com.google.firebase.storage.StorageReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * 저장된 글 하나. 웹앱의 users/{uid}/notes/{id} 와 같은 모양입니다.
 * [files] 가 있으면 사진·파일 글이고, [text] 에는 파일 이름들이 들어 있습니다(docs/FILES.md).
 */
data class Note(
    val id: String,
    val text: String,
    val createdAt: Long,
    val updatedAt: Long,
    val files: List<NoteFile> = emptyList(),
    val thumb: String? = null
) {
    val isFileNote: Boolean get() = files.isNotEmpty()
}

/**
 * 위젯이 그려야 할 상태. 네트워크가 없으면 마지막으로 받아 둔 값을 씁니다.
 * [stale] 은 서버에서 받지 못하고 캐시로 대신했다는 뜻이며, 저장하지 않습니다.
 */
data class WidgetState(
    val kind: Kind,
    val text: String = "",
    val syncedAt: Long = 0L,
    val stale: Boolean = false,
    /** 고정된 글의 id. 파일을 받아 둘 폴더 이름으로 씁니다. */
    val noteId: String = "",
    /** 사진·파일 글이면 그 파일들, 아니면 비어 있습니다. */
    val files: List<NoteFile> = emptyList(),
    /** 첫 번째 이미지의 미리보기 data URL (없으면 null) */
    val thumb: String? = null
) {
    enum class Kind { SIGNED_OUT, NOTHING_PINNED, OK }
}

object Repo {

    private const val PREFS = "postit.widget"
    private const val KEY_KIND = "kind"
    private const val KEY_TEXT = "text"
    private const val KEY_SYNCED_AT = "syncedAt"
    private const val KEY_NOTE_ID = "noteId"
    private const val KEY_FILES = "files"
    private const val KEY_THUMB = "thumb"

    /** 소유자 UID — 파일 하나 100MB 까지 (storage.rules 와 같은 값) */
    private const val OWNER_UID = "PKfixfmWHlVOfBMPPvaileeINRC3"
    private const val MAX_BYTES = 10L * 1024 * 1024
    private const val OWNER_MAX_BYTES = 100L * 1024 * 1024

    /** 파일 글의 text 는 이름들을 ", " 로 이어 이 길이에서 자릅니다. */
    private const val FILE_TEXT_MAX = 200

    /** 위젯을 눌러 앱이 새로 뜰 때 서버 연결을 기다리는 최대 시간 */
    private const val CONNECT_TIMEOUT_MS = 10_000L

    /* ---------- Firebase ---------- */

    val auth: FirebaseAuth get() = FirebaseAuth.getInstance()

    fun uid(): String? = auth.currentUser?.uid

    private fun userRef(uid: String): DatabaseReference =
        FirebaseDatabase.getInstance().reference.child("users").child(uid)

    fun notesRef(uid: String): DatabaseReference = userRef(uid).child("notes")

    fun pinnedRef(uid: String): DatabaseReference = userRef(uid).child("pinned")

    fun rootRef(uid: String): DatabaseReference = userRef(uid)

    /**
     * 새 글을 저장하고 그 id 를 돌려줍니다. 새 글은 곧바로 위젯에 고정됩니다.
     * 한 번의 쓰기로 묶어 글만 저장되고 고정이 빠지는 일이 없게 합니다.
     */
    suspend fun addNote(uid: String, text: String): String {
        val id = notesRef(uid).push().key!!
        rootRef(uid).updateChildren(
            mapOf(
                "notes/$id" to mapOf(
                    "text" to text,
                    "createdAt" to ServerValue.TIMESTAMP,
                    "updatedAt" to ServerValue.TIMESTAMP
                ),
                "pinned" to id
            )
        ).await()
        return id
    }

    /**
     * 사진·파일 글을 저장하고 그 id 를 돌려줍니다. 순서는 docs/FILES.md 를 따릅니다.
     *
     * 1. 글 id 를 먼저 받고 2. 파일마다 Storage `users/{uid}/{noteId}/{i}/{name}` 에 올린 뒤
     * 3. 한 번의 쓰기로 글과 `pinned` 를 함께 씁니다. 중간에 실패하면 올린 파일을 지웁니다.
     *
     * [fallbackNames] 는 ContentResolver 가 이름을 알려 주지 않을 때 쓸 이름(같은 순서)입니다.
     * [onProgress] 는 (올린 수, 전체 수) 로 불립니다.
     */
    suspend fun addFileNote(
        context: Context,
        uid: String,
        uris: List<Uri>,
        fallbackNames: List<String?> = emptyList(),
        onProgress: (Int, Int) -> Unit = { _, _ -> }
    ): String {
        if (uris.isEmpty()) throw IOException(context.getString(R.string.files_none))
        if (uris.size > NoteFiles.MAX_FILES) {
            throw IOException(context.getString(R.string.files_too_many, NoteFiles.MAX_FILES))
        }

        val picked = withContext(Dispatchers.IO) {
            uris.mapIndexed { i, uri -> NoteFiles.describe(context, uri, fallbackNames.getOrNull(i)) }
        }
        val maxBytes = if (uid == OWNER_UID) OWNER_MAX_BYTES else MAX_BYTES
        val limitText = context.getString(if (uid == OWNER_UID) R.string.files_limit_owner else R.string.files_limit)
        picked.firstOrNull { it.size > maxBytes }?.let {
            throw IOException(context.getString(R.string.files_too_big, it.name, limitText))
        }

        val id = notesRef(uid).push().key!!
        val uploaded = mutableListOf<StorageReference>()
        try {
            val files = ArrayList<NoteFile>(picked.size)
            onProgress(0, picked.size)
            for ((i, p) in picked.withIndex()) {
                val path = "users/$uid/$id/$i/${p.name}"
                val ref = NoteFiles.storage.reference.child(path)
                val size = upload(context, ref, p, maxBytes, limitText)
                uploaded += ref
                files += NoteFile(path, p.name, p.type, size)
                onProgress(i + 1, picked.size)
            }

            val thumb = picked.firstOrNull { it.type.startsWith("image/") }
                ?.let { NoteFiles.makeThumb(context, it.uri) }

            val note = mutableMapOf<String, Any>(
                "text" to files.joinToString(", ") { it.name }.take(FILE_TEXT_MAX),
                "createdAt" to ServerValue.TIMESTAMP,
                "updatedAt" to ServerValue.TIMESTAMP,
                "files" to files.map {
                    mapOf("path" to it.path, "name" to it.name, "type" to it.type, "size" to it.size)
                }
            )
            if (thumb != null) note["thumb"] = thumb

            rootRef(uid).updateChildren(mapOf("notes/$id" to note, "pinned" to id)).await()
            return id
        } catch (t: Throwable) {
            // 글이 써지지 않았으면 올려 둔 파일은 아무도 가리키지 않으므로 지웁니다(실패해도 무시).
            for (ref in uploaded) ref.delete()
            throw t
        }
    }

    /**
     * 파일 하나를 올리고 실제 크기를 돌려줍니다.
     * 크기를 미리 알 수 없던 파일은 먼저 캐시에 복사하면서 크기를 재고, 넘으면 올리지 않습니다.
     */
    @SuppressLint("Recycle") // 스트림은 use { } 로 닫습니다(lint 가 suspend 안의 use 를 따라가지 못함).
    private suspend fun upload(
        context: Context,
        ref: StorageReference,
        file: PickedFile,
        maxBytes: Long,
        limitText: String
    ): Long {
        val metadata = StorageMetadata.Builder().setContentType(file.type).build()

        if (file.size >= 0) {
            // 스트림은 올리기가 끝날 때까지 열어 둬야 하므로 await 를 use 안에서 기다립니다.
            val snapshot = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(file.uri) }
                ?.use { ref.putStream(it, metadata).await() }
                ?: throw IOException(context.getString(R.string.files_unreadable, file.name))
            return snapshot.metadata?.sizeBytes ?: snapshot.bytesTransferred
        }

        val temp = withContext(Dispatchers.IO) {
            File(context.cacheDir, "upload").mkdirs()
            val temp = File.createTempFile("up", null, File(context.cacheDir, "upload"))
            val input = context.contentResolver.openInputStream(file.uri)
                ?: throw IOException(context.getString(R.string.files_unreadable, file.name))
            input.use { src ->
                temp.outputStream().use { dst ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = src.read(buffer)
                        if (n < 0) break
                        total += n
                        if (total > maxBytes) {
                            throw IOException(context.getString(R.string.files_too_big, file.name, limitText))
                        }
                        dst.write(buffer, 0, n)
                    }
                }
            }
            temp
        }
        try {
            val snapshot = ref.putFile(Uri.fromFile(temp), metadata).await()
            return snapshot.metadata?.sizeBytes ?: temp.length()
        } finally {
            withContext(Dispatchers.IO) { temp.delete() }
        }
    }

    suspend fun updateNote(uid: String, id: String, text: String) {
        notesRef(uid).child(id)
            .updateChildren(mapOf("text" to text, "updatedAt" to ServerValue.TIMESTAMP))
            .await()
    }

    suspend fun deleteNote(context: Context, uid: String, note: Note) {
        deleteNotes(context, uid, listOf(note))
    }

    /**
     * 여러 글을 한 번의 쓰기로 지웁니다.
     * 고정된 글이 포함돼 있으면 같은 쓰기에서 고정도 함께 해제하므로,
     * 중간 상태(없는 글을 가리키는 pinned)가 생기지 않습니다.
     *
     * 사진·파일 글이면 글을 지운 뒤 Storage 의 파일과 기기에 받아 둔 파일도 지웁니다.
     * 이쪽은 기다리지 않고, 실패해도 무시합니다(docs/FILES.md "지우기").
     */
    suspend fun deleteNotes(context: Context, uid: String, notes: List<Note>) {
        if (notes.isEmpty()) return
        val ids = notes.map { it.id }

        val updates = mutableMapOf<String, Any?>()
        for (id in ids) updates["notes/$id"] = null

        val pinned = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinned != null && pinned in ids) updates["pinned"] = null

        rootRef(uid).updateChildren(updates).await()

        for (note in notes) {
            for (file in note.files) {
                runCatching { NoteFiles.storage.reference.child(file.path).delete() }
            }
            if (note.isFileNote) NoteFiles.forget(context, note.id)
        }
    }

    /* ---------- 읽기 ---------- */

    /** 글 하나를 읽습니다. files · thumb 가 없으면 기존 텍스트 글입니다. */
    fun parseNote(child: DataSnapshot): Note? {
        val id = child.key ?: return null
        val files = child.child("files").children.mapNotNull { f ->
            val path = f.child("path").getValue(String::class.java) ?: return@mapNotNull null
            NoteFile(
                path = path,
                name = f.child("name").getValue(String::class.java)?.takeIf { it.isNotEmpty() }
                    ?: path.substringAfterLast('/'),
                type = f.child("type").getValue(String::class.java)?.takeIf { it.isNotEmpty() }
                    ?: "application/octet-stream",
                size = f.child("size").getValue(Long::class.java) ?: 0L
            )
        }
        return Note(
            id = id,
            text = child.child("text").getValue(String::class.java).orEmpty(),
            createdAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
            updatedAt = child.child("updatedAt").getValue(Long::class.java) ?: 0L,
            files = files,
            thumb = child.child("thumb").getValue(String::class.java)?.takeIf { it.startsWith("data:image/") }
        )
    }

    suspend fun setPinned(uid: String, id: String?) {
        pinnedRef(uid).setValue(id).await()
    }

    /**
     * 서버와 실제로 연결될 때까지 기다립니다.
     *
     * 위젯을 눌러 앱 프로세스가 새로 뜨면 연결에 몇 초가 걸리는데, 그 전에 부른 get() 은
     * 약 3초 만에 "Client is offline" 으로 실패합니다. 그러면 예전 캐시가 복사되므로,
     * 연결을 먼저 확인한 뒤에 읽습니다.
     */
    private suspend fun awaitConnected(): Boolean {
        val db = FirebaseDatabase.getInstance()
        db.goOnline()
        val ref = db.getReference(".info/connected")
        val connected = callbackFlow {
            val listener = object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    trySend(snapshot.getValue(Boolean::class.java) == true)
                }

                override fun onCancelled(error: DatabaseError) {
                    close(error.toException())
                }
            }
            ref.addValueEventListener(listener)
            awaitClose { ref.removeEventListener(listener) }
        }
        return withTimeoutOrNull(CONNECT_TIMEOUT_MS) { connected.first { it } } == true
    }

    /** 위젯이 표시하거나 복사할 최신 텍스트를 서버에서 한 번 읽어 옵니다. */
    suspend fun fetchWidgetState(): WidgetState {
        val uid = uid() ?: return WidgetState(WidgetState.Kind.SIGNED_OUT)
        if (!awaitConnected()) throw IOException("서버에 연결하지 못했습니다.")

        val pinnedId = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinnedId.isNullOrEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        val note = parseNote(notesRef(uid).child(pinnedId).get().await())
        if (note == null || note.text.isEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        return WidgetState(
            WidgetState.Kind.OK, note.text, System.currentTimeMillis(),
            noteId = note.id, files = note.files, thumb = note.thumb
        )
    }

    /* ---------- 위젯용 로컬 캐시 ---------- */

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readCache(context: Context): WidgetState {
        val p = prefs(context)
        val kind = runCatching { WidgetState.Kind.valueOf(p.getString(KEY_KIND, null) ?: "") }
            .getOrDefault(WidgetState.Kind.SIGNED_OUT)
        return WidgetState(
            kind,
            p.getString(KEY_TEXT, "") ?: "",
            p.getLong(KEY_SYNCED_AT, 0L),
            noteId = p.getString(KEY_NOTE_ID, "") ?: "",
            files = decodeFiles(p.getString(KEY_FILES, null)),
            thumb = p.getString(KEY_THUMB, null)
        )
    }

    fun writeCache(context: Context, state: WidgetState) {
        prefs(context).edit()
            .putString(KEY_KIND, state.kind.name)
            .putString(KEY_TEXT, state.text)
            .putLong(KEY_SYNCED_AT, if (state.syncedAt > 0) state.syncedAt else System.currentTimeMillis())
            .putString(KEY_NOTE_ID, state.noteId)
            .putString(KEY_FILES, encodeFiles(state.files))
            .putString(KEY_THUMB, state.thumb)
            .apply()
    }

    /** 파일 목록은 작은 JSON 문자열 하나로 캐시에 둡니다. (없으면 null 로 지움) */
    private fun encodeFiles(files: List<NoteFile>): String? {
        if (files.isEmpty()) return null
        val array = JSONArray()
        for (f in files) {
            array.put(
                JSONObject().put("path", f.path).put("name", f.name).put("type", f.type).put("size", f.size)
            )
        }
        return array.toString()
    }

    private fun decodeFiles(json: String?): List<NoteFile> {
        if (json.isNullOrEmpty()) return emptyList()
        return runCatching {
            val array = JSONArray(json)
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                NoteFile(o.getString("path"), o.getString("name"), o.getString("type"), o.getLong("size"))
            }
        }.getOrDefault(emptyList())
    }

    fun clearCache(context: Context) {
        writeCache(context, WidgetState(WidgetState.Kind.SIGNED_OUT))
    }

    /**
     * 서버에서 최신 상태를 받아 캐시에 넣고 돌려줍니다.
     * 네트워크 오류 등으로 실패하면 캐시에 있던 값을 그대로 돌려줍니다.
     */
    suspend fun syncWidgetState(context: Context): WidgetState {
        return try {
            val fresh = fetchWidgetState()
            writeCache(context, fresh)
            fresh
        } catch (t: Throwable) {
            readCache(context).copy(stale = true)
        }
    }
}
