package kr.ai.shy.postit

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.IntentCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * 다른 앱의 "공유" 시트에서 Post-it 을 고르면 그 텍스트를 바로 저장합니다.
 * 폰에서 발견한 문장을 데스크톱으로 넘기는 가장 빠른 경로입니다.
 *
 * 사진·파일(EXTRA_STREAM, 여러 개면 SEND_MULTIPLE)을 공유하면 파일 글로 올립니다.
 * 받은 content:// 읽기 권한은 이 화면이 살아 있는 동안만 유효하므로, 다 올릴 때까지 닫지 않습니다.
 */
class ShareActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val intent = intent
        val text = intent?.takeIf { it.action == Intent.ACTION_SEND }
            ?.getStringExtra(Intent.EXTRA_TEXT)
            ?.trim()
            .orEmpty()
        val uris = streams(intent)

        // 글과 파일이 함께 오면(예: 링크 + 미리보기 그림) text/plain 일 때만 글로 저장합니다.
        val isText = text.isNotEmpty() && (uris.isEmpty() || intent?.type == "text/plain")

        if (!isText && uris.isEmpty()) {
            Toast.makeText(this, R.string.empty_input, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        val uid = Repo.uid()
        if (uid == null) {
            Toast.makeText(this, R.string.need_signin, Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }

        if (!isText) Toast.makeText(this, R.string.uploading, Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            try {
                if (isText) Repo.addNote(uid, text)
                else Repo.addFileNote(applicationContext, uid, uris)
                Toast.makeText(this@ShareActivity, R.string.saved, Toast.LENGTH_SHORT).show()
                Repo.syncWidgetState(applicationContext)
                PostItWidget.renderAll(applicationContext)
            } catch (t: Throwable) {
                Toast.makeText(
                    this@ShareActivity,
                    t.localizedMessage ?: "저장에 실패했습니다.",
                    Toast.LENGTH_LONG
                ).show()
            }
            finish()
        }
    }

    /** 공유로 받은 파일 주소들. SEND 는 하나, SEND_MULTIPLE 은 여러 개. */
    private fun streams(intent: Intent?): List<Uri> = when (intent?.action) {
        Intent.ACTION_SEND ->
            listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))

        Intent.ACTION_SEND_MULTIPLE ->
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                ?.filterNotNull()
                .orEmpty()

        else -> emptyList()
    }
}
