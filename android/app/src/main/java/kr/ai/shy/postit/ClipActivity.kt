package kr.ai.shy.postit

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File

/**
 * 위젯 탭을 처리하는, 눈에 보이지 않는 액티비티.
 *
 * Android 10(API 29)부터 포그라운드에 있지 않은 앱은 클립보드를 읽거나 쓸 수 없습니다.
 * 그래서 위젯의 PendingIntent 가 브로드캐스트가 아니라 이 투명 액티비티를 띄우고,
 * 창이 포커스를 얻은 뒤에 클립보드를 만지고 곧바로 종료합니다.
 */
class ClipActivity : ComponentActivity() {

    companion object {
        const val ACTION_COPY = "kr.ai.shy.postit.COPY"
        const val ACTION_SAVE_CLIPBOARD = "kr.ai.shy.postit.SAVE_CLIPBOARD"
        private const val FOCUS_TIMEOUT_MS = 3000L

        /** 파일 받기가 이보다 오래 걸리면 "받는 중…" 을 띄웁니다. */
        private const val SLOW_TOAST_MS = 700L
    }

    private val focused = CompletableDeferred<Unit>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        when (intent?.action) {
            ACTION_COPY -> lifecycleScope.launch { copyPinned() }
            ACTION_SAVE_CLIPBOARD -> lifecycleScope.launch { saveClipboard() }
            else -> finish()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !focused.isCompleted) focused.complete(Unit)
    }

    /** 창이 포커스를 얻을 때까지 기다립니다. 못 얻으면 그냥 진행합니다. */
    private suspend fun awaitFocus() {
        withTimeoutOrNull(FOCUS_TIMEOUT_MS) { focused.await() }
    }

    private fun clipboard(): ClipboardManager =
        getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    /** Android 13부터는 시스템이 복사 사실을 직접 알려 주므로 토스트를 겹치지 않게 합니다. */
    private fun toastUnlessSystemShows(message: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }

    private suspend fun copyPinned() {
        // 표시된 내용이 조금 오래됐더라도 복사되는 것은 항상 최신이도록 먼저 받아 옵니다.
        val state = Repo.syncWidgetState(applicationContext)
        PostItWidget.renderAll(applicationContext)
        awaitFocus()

        when (state.kind) {
            WidgetState.Kind.SIGNED_OUT ->
                Toast.makeText(this, R.string.need_signin, Toast.LENGTH_SHORT).show()

            WidgetState.Kind.NOTHING_PINNED ->
                Toast.makeText(this, R.string.nothing_pinned, Toast.LENGTH_SHORT).show()

            WidgetState.Kind.OK -> if (state.files.isNotEmpty()) {
                copyFiles(state)
            } else {
                clipboard().setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), state.text))
                // 최신 글을 받지 못했으면 시스템 알림과 상관없이 꼭 알려 줍니다.
                if (state.stale) Toast.makeText(this, R.string.copied_stale, Toast.LENGTH_LONG).show()
                else toastUnlessSystemShows(getString(R.string.copied))
            }
        }
        finish()
    }

    /**
     * 사진·파일 글: 파일을 기기에 받아 두고 content:// 주소로 클립보드에 넣습니다.
     * 오프라인이면 전에 받아 둔 파일이 다 있을 때만 그것을 씁니다.
     */
    private suspend fun copyFiles(state: WidgetState) {
        var fromCache = state.stale
        val locals: List<File>? = if (state.stale) {
            NoteFiles.cached(this, state.noteId, state.files)
        } else {
            // 금방 끝나면 토스트 없이, 오래 걸릴 때만 "받는 중…" 을 보여 줍니다.
            val slow = lifecycleScope.launch {
                delay(SLOW_TOAST_MS)
                Toast.makeText(this@ClipActivity, R.string.downloading, Toast.LENGTH_SHORT).show()
            }
            try {
                runCatching { NoteFiles.download(this, state.noteId, state.files) }.getOrNull()
                    ?: NoteFiles.cached(this, state.noteId, state.files)?.also { fromCache = true }
            } finally {
                slow.cancel()
            }
        }

        if (locals == null) {
            val message = if (state.stale) R.string.files_offline else R.string.files_download_failed
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            return
        }

        val uris = NoteFiles.contentUris(this, locals)
        clipboard().setPrimaryClip(NoteFiles.clipOf(this, getString(R.string.app_name), uris))
        // 최신 파일을 받지 못했으면 시스템 알림과 상관없이 꼭 알려 줍니다.
        if (fromCache) Toast.makeText(this, R.string.copied_files_stale, Toast.LENGTH_LONG).show()
        else toastUnlessSystemShows(getString(R.string.copied))
    }

    private suspend fun saveClipboard() {
        awaitFocus()

        val uid = Repo.uid()
        if (uid == null) {
            Toast.makeText(this, R.string.need_signin, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val clip = clipboard().primaryClip?.takeIf { it.itemCount > 0 }

        // 사진·파일을 복사해 둔 경우(갤러리·파일 앱의 "복사") → 파일 글로 올립니다.
        val uris = clip?.let { c ->
            (0 until c.itemCount).mapNotNull { c.getItemAt(it).uri }
                .filter { it.scheme == ContentResolver.SCHEME_CONTENT }
        }.orEmpty()
        if (uris.isNotEmpty()) {
            saveFiles(uid, uris)
            finish()
            return
        }

        val text = clip
            ?.getItemAt(0)
            ?.coerceToText(this)
            ?.toString()
            ?.trim()
            .orEmpty()

        if (text.isEmpty()) {
            Toast.makeText(this, R.string.clipboard_empty, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        try {
            Repo.addNote(uid, text)
            Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
            Repo.syncWidgetState(applicationContext)
            PostItWidget.renderAll(applicationContext)
        } catch (t: Throwable) {
            Toast.makeText(this, t.localizedMessage ?: "저장에 실패했습니다.", Toast.LENGTH_LONG).show()
        }
        finish()
    }

    private suspend fun saveFiles(uid: String, uris: List<Uri>) {
        Toast.makeText(this, R.string.uploading, Toast.LENGTH_SHORT).show()
        try {
            Repo.addFileNote(applicationContext, uid, uris)
            Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
            Repo.syncWidgetState(applicationContext)
            PostItWidget.renderAll(applicationContext)
        } catch (t: Throwable) {
            Toast.makeText(this, t.localizedMessage ?: "저장에 실패했습니다.", Toast.LENGTH_LONG).show()
        }
    }
}
