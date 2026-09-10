package kr.ai.shy.postit

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * 다른 앱의 "공유" 시트에서 Post-it 을 고르면 그 텍스트를 바로 저장합니다.
 * 폰에서 발견한 문장을 데스크톱으로 넘기는 가장 빠른 경로입니다.
 */
class ShareActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = intent?.takeIf { it.action == Intent.ACTION_SEND }
            ?.getStringExtra(Intent.EXTRA_TEXT)
            ?.trim()
            .orEmpty()

        if (text.isEmpty()) {
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

        lifecycleScope.launch {
            try {
                Repo.addNote(uid, text)
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
}
