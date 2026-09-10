package kr.ai.shy.postit

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import kotlinx.coroutines.tasks.await

/** 저장된 글 하나. 웹앱의 users/{uid}/notes/{id} 와 같은 모양입니다. */
data class Note(
    val id: String,
    val text: String,
    val createdAt: Long,
    val updatedAt: Long
)

/** 위젯이 그려야 할 상태. 네트워크가 없으면 마지막으로 받아 둔 값을 씁니다. */
data class WidgetState(
    val kind: Kind,
    val text: String = "",
    val syncedAt: Long = 0L
) {
    enum class Kind { SIGNED_OUT, NOTHING_PINNED, OK }
}

object Repo {

    private const val PREFS = "postit.widget"
    private const val KEY_KIND = "kind"
    private const val KEY_TEXT = "text"
    private const val KEY_SYNCED_AT = "syncedAt"

    /* ---------- Firebase ---------- */

    val auth: FirebaseAuth get() = FirebaseAuth.getInstance()

    fun uid(): String? = auth.currentUser?.uid

    private fun userRef(uid: String): DatabaseReference =
        FirebaseDatabase.getInstance().reference.child("users").child(uid)

    fun notesRef(uid: String): DatabaseReference = userRef(uid).child("notes")

    fun pinnedRef(uid: String): DatabaseReference = userRef(uid).child("pinned")

    fun rootRef(uid: String): DatabaseReference = userRef(uid)

    /** 새 글을 저장하고 그 id 를 돌려줍니다. 고정된 글이 없으면 자동으로 고정합니다. */
    suspend fun addNote(uid: String, text: String): String {
        val ref = notesRef(uid).push()
        ref.setValue(
            mapOf(
                "text" to text,
                "createdAt" to ServerValue.TIMESTAMP,
                "updatedAt" to ServerValue.TIMESTAMP
            )
        ).await()

        val pinned = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinned.isNullOrEmpty()) {
            pinnedRef(uid).setValue(ref.key).await()
        }
        return ref.key!!
    }

    suspend fun updateNote(uid: String, id: String, text: String) {
        notesRef(uid).child(id)
            .updateChildren(mapOf("text" to text, "updatedAt" to ServerValue.TIMESTAMP))
            .await()
    }

    suspend fun deleteNote(uid: String, id: String) {
        notesRef(uid).child(id).removeValue().await()
        val pinned = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinned == id) pinnedRef(uid).setValue(null).await()
    }

    suspend fun setPinned(uid: String, id: String?) {
        pinnedRef(uid).setValue(id).await()
    }

    /** 위젯이 표시하거나 복사할 최신 텍스트를 서버에서 한 번 읽어 옵니다. */
    suspend fun fetchWidgetState(): WidgetState {
        val uid = uid() ?: return WidgetState(WidgetState.Kind.SIGNED_OUT)

        val pinnedId = pinnedRef(uid).get().await().getValue(String::class.java)
        if (pinnedId.isNullOrEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        val text = notesRef(uid).child(pinnedId).child("text").get().await()
            .getValue(String::class.java)
        if (text.isNullOrEmpty()) return WidgetState(WidgetState.Kind.NOTHING_PINNED)

        return WidgetState(WidgetState.Kind.OK, text, System.currentTimeMillis())
    }

    /* ---------- 위젯용 로컬 캐시 ---------- */

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readCache(context: Context): WidgetState {
        val p = prefs(context)
        val kind = runCatching { WidgetState.Kind.valueOf(p.getString(KEY_KIND, null) ?: "") }
            .getOrDefault(WidgetState.Kind.SIGNED_OUT)
        return WidgetState(kind, p.getString(KEY_TEXT, "") ?: "", p.getLong(KEY_SYNCED_AT, 0L))
    }

    fun writeCache(context: Context, state: WidgetState) {
        prefs(context).edit()
            .putString(KEY_KIND, state.kind.name)
            .putString(KEY_TEXT, state.text)
            .putLong(KEY_SYNCED_AT, if (state.syncedAt > 0) state.syncedAt else System.currentTimeMillis())
            .apply()
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
            readCache(context)
        }
    }
}
