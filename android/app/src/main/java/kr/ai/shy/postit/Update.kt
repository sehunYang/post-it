package kr.ai.shy.postit

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * GitHub Releases 에 올라온 최신 APK 버전을 확인합니다.
 *
 * 앱스토어를 거치지 않고 APK 를 직접 받아 설치하는 방식이라,
 * 새 버전이 올라온 것을 알려 줄 곳이 앱 안밖에 없습니다.
 * 네트워크가 없으면 마지막으로 확인해 둔 값을 그대로 씁니다. 실패해도 절대 앱을 멈추지 않습니다.
 */
object Update {

    /** 새 APK 를 내려받는 주소. 릴리스마다 같은 파일 이름을 씁니다. */
    const val DOWNLOAD_URL = "https://github.com/sehunYang/post-it/releases/latest/download/post-it.apk"

    private const val API = "https://api.github.com/repos/sehunYang/post-it/releases/latest"
    private const val PREFS = "postit.update"
    private const val KEY_CHECKED_AT = "checkedAt"
    private const val KEY_LATEST = "latest"

    /** 같은 하루에 몇 번씩 물어보지 않도록 12시간에 한 번만 확인합니다. */
    private const val INTERVAL_MS = 12L * 60L * 60L * 1000L

    private const val TIMEOUT_MS = 8_000

    /**
     * 지금 버전보다 새 버전이 있으면 그 버전 이름을, 없으면 null 을 돌려줍니다.
     * 확인한 지 12시간이 지나지 않았으면 저장해 둔 값으로만 판단합니다.
     */
    suspend fun newerVersion(context: Context): String? {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val due = now - prefs.getLong(KEY_CHECKED_AT, 0L) >= INTERVAL_MS

        if (due) {
            val fetched = fetchLatest()
            if (fetched != null) {
                prefs.edit()
                    .putString(KEY_LATEST, fetched)
                    .putLong(KEY_CHECKED_AT, now)
                    .apply()
            }
        }

        val latest = prefs.getString(KEY_LATEST, null) ?: return null
        return if (isNewer(latest, BuildConfig.VERSION_NAME)) latest else null
    }

    /** tag_name 을 읽어 앞의 v 를 떼고 돌려줍니다. 실패하면 null. */
    private suspend fun fetchLatest(): String? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = (URL(API).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("Accept", "application/vnd.github+json")
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
            }
            val body = try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return@runCatching null
                connection.inputStream.bufferedReader().use { it.readText() }
            } finally {
                connection.disconnect()
            }
            JSONObject(body).optString("tag_name")
                .removePrefix("v")
                .trim()
                .takeIf { it.isNotEmpty() }
        }.getOrNull()
    }

    /** "1.10" 이 "1.9" 보다 새 버전이 되도록 점으로 나눠 숫자로 견줍니다. */
    private fun isNewer(latest: String, current: String): Boolean {
        val a = parts(latest)
        val b = parts(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val left = a.getOrElse(i) { 0 }
            val right = b.getOrElse(i) { 0 }
            if (left != right) return left > right
        }
        return false
    }

    private fun parts(version: String): List<Int> =
        version.split(".").map { part -> part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
}
