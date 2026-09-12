package kr.ai.shy.postit

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * 가로로 넓은 기본 위젯(4x2).
 *
 * 2x2 정사각 위젯은 [PostItWidgetSmall] 이며, 동작은 이 클래스를 그대로 물려받고
 * 레이아웃만 다릅니다. 위젯 선택 화면에는 두 가지가 따로 보입니다.
 */
open class PostItWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "kr.ai.shy.postit.ACTION_REFRESH"
        private const val SYNC_WORK = "postit.widget.sync"

        /** 화면에 올라올 수 있는 모든 위젯 종류와 각자의 레이아웃. */
        private val PROVIDERS: List<Pair<Class<out PostItWidget>, Int>> = listOf(
            PostItWidget::class.java to R.layout.widget_postit,
            PostItWidgetSmall::class.java to R.layout.widget_postit_small
        )

        /** 캐시에 있는 값으로 모든 크기의 위젯을 다시 그립니다. */
        fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val state = Repo.readCache(context)

            for ((provider, layout) in PROVIDERS) {
                val ids = manager.getAppWidgetIds(ComponentName(context, provider))
                if (ids.isEmpty()) continue
                val views = buildViews(context, layout, state)
                for (id in ids) manager.updateAppWidget(id, views)
            }
        }

        private fun buildViews(context: Context, layout: Int, state: WidgetState): RemoteViews {
            val views = RemoteViews(context.packageName, layout)

            when (state.kind) {
                WidgetState.Kind.SIGNED_OUT -> {
                    views.setTextViewText(R.id.widget_text, context.getString(R.string.widget_signin))
                    views.setTextViewText(R.id.widget_footer, "")
                }
                WidgetState.Kind.NOTHING_PINNED -> {
                    views.setTextViewText(R.id.widget_text, context.getString(R.string.widget_empty))
                    views.setTextViewText(R.id.widget_footer, "")
                }
                WidgetState.Kind.OK -> {
                    views.setTextViewText(R.id.widget_text, state.text)
                    views.setTextViewText(R.id.widget_footer, relativeTime(state.syncedAt))
                }
            }

            // 본문을 누르면 → 최신 내용을 받아 클립보드로 복사
            views.setOnClickPendingIntent(
                R.id.widget_text,
                activityIntent(context, ClipActivity.ACTION_COPY, 1)
            )
            // 클립보드 아이콘을 누르면 → 지금 클립보드 내용을 새 글로 저장 (폰 → 데스크톱)
            views.setOnClickPendingIntent(
                R.id.widget_save_clip,
                activityIntent(context, ClipActivity.ACTION_SAVE_CLIPBOARD, 2)
            )
            views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))

            return views
        }

        private fun activityIntent(context: Context, action: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, ClipActivity::class.java).apply {
                this.action = action
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            }
            return PendingIntent.getActivity(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun refreshIntent(context: Context): PendingIntent {
            val intent = Intent(context, PostItWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(
                context, 3, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private fun relativeTime(syncedAt: Long): String {
            if (syncedAt <= 0L) return ""
            val minutes = (System.currentTimeMillis() - syncedAt) / 60_000L
            return when {
                minutes < 1 -> "방금 동기화"
                minutes < 60 -> "${minutes}분 전 동기화"
                minutes < 1440 -> "${minutes / 60}시간 전 동기화"
                else -> "${minutes / 1440}일 전 동기화"
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        // 먼저 캐시로 즉시 그리고, 최신 내용은 백그라운드에서 받아 옵니다.
        renderAll(context)
        WidgetSyncWorker.runOnce(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            WidgetSyncWorker.runOnce(context)
        }
    }

    override fun onEnabled(context: Context) {
        // 화면을 보고 있지 않아도 주기적으로 내용을 맞춰 둡니다. (WorkManager 최소 주기 15분)
        val request = PeriodicWorkRequestBuilder<WidgetSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SYNC_WORK, ExistingPeriodicWorkPolicy.KEEP, request
        )
    }

    override fun onDisabled(context: Context) {
        // 두 종류 모두 사라졌을 때만 주기 작업을 멈춥니다.
        val manager = AppWidgetManager.getInstance(context)
        val stillPlaced = PROVIDERS.any { (provider, _) ->
            manager.getAppWidgetIds(ComponentName(context, provider)).isNotEmpty()
        }
        if (!stillPlaced) WorkManager.getInstance(context).cancelUniqueWork(SYNC_WORK)
    }
}
