package kr.ai.shy.postit

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager

/** 서버에서 고정된 글을 받아 캐시에 넣고 위젯을 다시 그립니다. */
class WidgetSyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            Repo.syncWidgetState(applicationContext)
            PostItWidget.renderAll(applicationContext)
            Result.success()
        } catch (t: Throwable) {
            PostItWidget.renderAll(applicationContext)
            Result.retry()
        }
    }

    companion object {
        fun runOnce(context: Context) {
            WorkManager.getInstance(context.applicationContext)
                .enqueue(OneTimeWorkRequestBuilder<WidgetSyncWorker>().build())
        }
    }
}
