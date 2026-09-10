package kr.ai.shy.postit

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.PopupMenu
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kr.ai.shy.postit.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: NoteAdapter

    private var notes: List<Note> = emptyList()
    private var pinnedId: String? = null
    private var editingId: String? = null

    private var listener: ValueEventListener? = null
    private var listeningUid: String? = null

    private val authListener = FirebaseAuth.AuthStateListener { onAuthChanged() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (!firebaseReady()) return

        setUpList()
        setUpComposer()

        binding.btnSignin.setOnClickListener { signIn() }
        binding.btnSignout.setOnClickListener { signOut() }

        Repo.auth.addAuthStateListener(authListener)
    }

    override fun onDestroy() {
        if (firebaseAvailable) {
            Repo.auth.removeAuthStateListener(authListener)
            detachListener()
        }
        super.onDestroy()
    }

    /* ---------- Firebase 준비 확인 ---------- */

    private var firebaseAvailable = false

    private fun firebaseReady(): Boolean {
        firebaseAvailable = runCatching { Repo.auth; true }.getOrDefault(false)
        if (!firebaseAvailable) {
            AlertDialog.Builder(this)
                .setTitle("Firebase 설정이 없습니다")
                .setMessage(
                    "app/google-services.json 파일이 없거나 잘못되었습니다.\n\n" +
                        "Firebase 콘솔에서 이 앱(kr.ai.shy.postit)을 등록하고 " +
                        "google-services.json 을 android/app/ 아래에 넣은 뒤 다시 빌드해 주세요."
                )
                .setCancelable(false)
                .setPositiveButton("닫기") { _, _ -> finish() }
                .show()
        }
        return firebaseAvailable
    }

    /* ---------- 로그인 ---------- */

    /** google-services.json 이 만들어 준 값을 먼저 쓰고, 없으면 수동 설정값을 씁니다. */
    private fun webClientId(): String {
        val resId = resources.getIdentifier("default_web_client_id", "string", packageName)
        val generated = if (resId != 0) getString(resId) else ""
        return generated.ifEmpty { getString(R.string.web_client_id) }
    }

    private fun signIn() {
        val clientId = webClientId()
        if (clientId.isEmpty()) {
            Toast.makeText(this, "웹 클라이언트 ID 를 찾을 수 없습니다.", Toast.LENGTH_LONG).show()
            return
        }

        binding.btnSignin.isEnabled = false
        lifecycleScope.launch {
            try {
                val option = GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setServerClientId(clientId)
                    .setAutoSelectEnabled(false)
                    .build()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(option)
                    .build()

                val response = CredentialManager.create(this@MainActivity)
                    .getCredential(this@MainActivity, request)

                val credential = response.credential
                if (credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
                    Repo.auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
                } else {
                    Toast.makeText(this@MainActivity, R.string.signin_failed, Toast.LENGTH_SHORT).show()
                }
            } catch (t: Throwable) {
                Toast.makeText(
                    this@MainActivity,
                    getString(R.string.signin_failed) + "\n" + (t.localizedMessage ?: ""),
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                binding.btnSignin.isEnabled = true
            }
        }
    }

    private fun signOut() {
        detachListener()
        Repo.auth.signOut()
        Repo.clearCache(this)
        PostItWidget.renderAll(this)
    }

    private fun onAuthChanged() {
        val uid = Repo.uid()
        if (uid == null) {
            detachListener()
            notes = emptyList()
            pinnedId = null
            binding.gate.visibility = View.VISIBLE
            binding.app.visibility = View.GONE
            return
        }

        binding.gate.visibility = View.GONE
        binding.app.visibility = View.VISIBLE
        binding.accountMail.text = Repo.auth.currentUser?.email.orEmpty()
        attachListener(uid)
    }

    /* ---------- 실시간 목록 ---------- */

    private fun attachListener(uid: String) {
        if (listeningUid == uid && listener != null) return
        detachListener()

        val l = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                pinnedId = snapshot.child("pinned").getValue(String::class.java)
                notes = snapshot.child("notes").children.mapNotNull { child ->
                    val id = child.key ?: return@mapNotNull null
                    Note(
                        id = id,
                        text = child.child("text").getValue(String::class.java).orEmpty(),
                        createdAt = child.child("createdAt").getValue(Long::class.java) ?: 0L,
                        updatedAt = child.child("updatedAt").getValue(Long::class.java) ?: 0L
                    )
                }.sortedByDescending { if (it.updatedAt > 0) it.updatedAt else it.createdAt }

                render()
                syncWidget()
            }

            override fun onCancelled(error: DatabaseError) {
                Toast.makeText(
                    this@MainActivity,
                    "읽기 실패: " + error.message,
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        Repo.rootRef(uid).addValueEventListener(l)
        listener = l
        listeningUid = uid
    }

    private fun detachListener() {
        val uid = listeningUid
        val l = listener
        if (uid != null && l != null) Repo.rootRef(uid).removeEventListener(l)
        listener = null
        listeningUid = null
    }

    private fun syncWidget() {
        lifecycleScope.launch {
            Repo.syncWidgetState(applicationContext)
            PostItWidget.renderAll(applicationContext)
        }
    }

    /* ---------- 화면 그리기 ---------- */

    private fun setUpList() {
        adapter = NoteAdapter(
            onCopy = ::copyToClipboard,
            onPin = { note, pinned -> togglePin(note, pinned) },
            onMore = ::showMore
        )
        binding.list.layoutManager = LinearLayoutManager(this)
        binding.list.adapter = adapter
    }

    private fun render() {
        val rows = notes
            .map { NoteRow(it, it.id == pinnedId) }
            .sortedByDescending { it.pinned }
        adapter.submitList(rows)
        binding.empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
    }

    /* ---------- 입력 ---------- */

    private fun setUpComposer() {
        updateCounter()
        binding.input.doAfterTextChanged { updateCounter() }
        binding.btnSave.setOnClickListener { save() }
        binding.btnCancelEdit.setOnClickListener { cancelEdit() }
    }

    private fun updateCounter() {
        binding.counter.text = getString(R.string.char_count, binding.input.text?.length ?: 0)
    }

    private fun save() {
        val uid = Repo.uid() ?: return
        val text = binding.input.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) {
            Toast.makeText(this, R.string.empty_input, Toast.LENGTH_SHORT).show()
            return
        }

        val id = editingId
        binding.btnSave.isEnabled = false
        lifecycleScope.launch {
            try {
                if (id != null) {
                    Repo.updateNote(uid, id, text)
                    toast(R.string.updated)
                    cancelEdit()
                } else {
                    Repo.addNote(uid, text)
                    binding.input.setText("")
                    toast(R.string.saved)
                }
            } catch (t: Throwable) {
                Toast.makeText(this@MainActivity, t.localizedMessage ?: "실패했습니다.", Toast.LENGTH_LONG).show()
            } finally {
                binding.btnSave.isEnabled = true
            }
        }
    }

    private fun startEdit(note: Note) {
        editingId = note.id
        binding.input.setText(note.text)
        binding.input.setSelection(note.text.length)
        binding.input.requestFocus()
        binding.btnSave.setText(R.string.save_edit)
        binding.btnCancelEdit.visibility = View.VISIBLE
    }

    private fun cancelEdit() {
        editingId = null
        binding.input.setText("")
        binding.btnSave.setText(R.string.save)
        binding.btnCancelEdit.visibility = View.GONE
    }

    /* ---------- 항목 동작 ---------- */

    private fun copyToClipboard(note: Note) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), note.text))
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) toast(R.string.copied)
    }

    private fun togglePin(note: Note, pinned: Boolean) {
        val uid = Repo.uid() ?: return
        lifecycleScope.launch {
            runCatching { Repo.setPinned(uid, if (pinned) null else note.id) }
                .onSuccess { toast(if (pinned) R.string.unpinned_done else R.string.pinned_done) }
                .onFailure {
                    Toast.makeText(this@MainActivity, it.localizedMessage ?: "실패했습니다.", Toast.LENGTH_LONG).show()
                }
        }
    }

    private fun showMore(anchor: View, note: Note) {
        PopupMenu(this, anchor).apply {
            menu.add(0, 1, 0, R.string.action_edit)
            menu.add(0, 2, 1, R.string.action_delete)
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    1 -> { startEdit(note); true }
                    2 -> { confirmDelete(note); true }
                    else -> false
                }
            }
            show()
        }
    }

    private fun confirmDelete(note: Note) {
        val preview = if (note.text.length > 24) note.text.take(24) + "…" else note.text
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_confirm_title)
            .setMessage("\"" + preview + "\"")
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.action_delete) { _, _ ->
                val uid = Repo.uid() ?: return@setPositiveButton
                lifecycleScope.launch {
                    runCatching { Repo.deleteNote(uid, note.id) }
                        .onSuccess {
                            if (editingId == note.id) cancelEdit()
                            toast(R.string.deleted)
                        }
                        .onFailure {
                            Toast.makeText(this@MainActivity, it.localizedMessage ?: "실패했습니다.", Toast.LENGTH_LONG).show()
                        }
                }
            }
            .show()
    }

    private fun toast(resId: Int) = Toast.makeText(this, resId, Toast.LENGTH_SHORT).show()
}
