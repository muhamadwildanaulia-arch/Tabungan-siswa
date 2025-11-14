// app.js (modular)
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

/* Menggunakan window.__FIREBASE yang dibuat di index.html */
const auth = window.__FIREBASE.auth;
const db = window.__FIREBASE.db;

/* ---------- helper DOM ---------- */
const $ = sel => document.querySelector(sel);
const emailInput = $('#email');
const passInput = $('#password');
const btnLogin = $('#btn-login');
const btnRegister = $('#btn-register');
const btnLogout = $('#btn-logout');
const userInfo = $('#user-info');
const userEmail = $('#user-email');

const appSection = $('#app');
const studentSelect = $('#student-select');
const amountInput = $('#amount');
const typeSelect = $('#type');
const noteInput = $('#note');
const btnSubmit = $('#btn-submit');
const balanceSpan = $('#balance');
const txList = $('#tx-list');
const pendingList = $('#pending-list');

function show(el){ if(el) el.hidden = false; }
function hide(el){ if(el) el.hidden = true; }

btnLogin.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passInput.value;
  if (!email || !password) return alert('Masukkan email & password.');
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    console.error('Login error', e);
    alert('Login gagal: ' + (e.message || e.code));
  }
});

btnRegister.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passInput.value;
  if (!email || !password) return alert('Masukkan email & password.');
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      email: email,
      role: 'student',
      createdAt: serverTimestamp()
    });
    alert('Registrasi berhasil. Silakan login.');
  } catch (e) {
    console.error('Register error', e);
    alert('Register gagal: ' + (e.message || e.code));
  }
});

btnLogout.addEventListener('click', async () => {
  await signOut(auth);
});

/* Auth state listener */
onAuthStateChanged(auth, async user => {
  if (user) {
    userEmail.textContent = user.email;
    show(userInfo);
    show(appSection);
    hide(document.getElementById('auth-forms'));
    await loadStudents();
    subscribeTransactions();
  } else {
    hide(userInfo);
    hide(appSection);
    show(document.getElementById('auth-forms'));
  }
});

/* Load students */
async function loadStudents() {
  studentSelect.innerHTML = '<option value="">-- pilih siswa --</option>';
  try {
    const q = query(collection(db, 'students'), orderBy('name'));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${data.nis || '-'} — ${data.name || '(nama)'}${data.class ? ' ('+data.class+')' : ''}`;
      studentSelect.appendChild(opt);
    });
    updateBalanceForSelected();
  } catch (e) {
    console.error('Load students error', e);
    alert('Gagal memuat daftar siswa. Cek console.');
  }
}

studentSelect.addEventListener('change', updateBalanceForSelected);

async function updateBalanceForSelected() {
  const sid = studentSelect.value;
  if (!sid) {
    balanceSpan.textContent = 'Rp 0';
    return;
  }
  try {
    const bdoc = await getDoc(doc(db, 'balances', sid));
    const bal = bdoc.exists() ? (bdoc.data().balance || 0) : 0;
    balanceSpan.textContent = formatCurrency(bal);
  } catch (e) {
    console.error('Update balance error', e);
    balanceSpan.textContent = 'Rp -';
  }
}

function formatCurrency(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

/* Submit transaksi (status pending) */
btnSubmit.addEventListener('click', async () => {
  const sid = studentSelect.value;
  const amount = Number(amountInput.value);
  const type = typeSelect.value;
  const note = noteInput.value || '';
  if (!sid || !amount || amount <= 0) return alert('Pilih siswa & masukkan jumlah valid.');
  try {
    await addDoc(collection(db, 'transactions'), {
      studentId: sid,
      amount: amount,
      type: type,
      note: note,
      status: 'pending',
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid || null
    });
    alert('Transaksi dikirim untuk verifikasi.');
    amountInput.value = '';
    noteInput.value = '';
  } catch (e) {
    console.error('Create tx error', e);
    alert('Gagal membuat transaksi.');
  }
});

/* Subscribe realtime transactions */
function subscribeTransactions() {
  try {
    const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
    onSnapshot(q, snap => {
      txList.innerHTML = '';
      pendingList.innerHTML = '';
      snap.forEach(docSnap => {
        const d = docSnap.data();
        const li = document.createElement('li');
        li.textContent = `${d.type} ${formatCurrency(d.amount)} — ${d.note || '-'} [${d.status || ''}]`;
        txList.appendChild(li);

        if (d.status === 'pending') {
          const pli = document.createElement('li');
          pli.textContent = `${d.studentId}: ${d.type} ${formatCurrency(d.amount)}`;
          const btnApprove = document.createElement('button');
          btnApprove.textContent = 'Approve';
          btnApprove.style.marginLeft = '8px';
          btnApprove.onclick = async () => await approveTx(docSnap.id, d);
          pli.appendChild(btnApprove);
          pendingList.appendChild(pli);
        }
      });
    });
  } catch (e) {
    console.error('Subscribe tx error', e);
  }
}

/* Approve tx (demo client-side) */
async function approveTx(txId, data) {
  try {
    const uid = auth.currentUser.uid;
    const udoc = await getDoc(doc(db, 'users', uid));
    if (!udoc.exists() || udoc.data().role !== 'admin') return alert('Hanya admin yang dapat approve.');

    const txRef = doc(db, 'transactions', txId);
    const balRef = doc(db, 'balances', data.studentId);

    await runTransaction(db, async t => {
      const balDoc = await t.get(balRef);
      let bal = 0;
      if (balDoc.exists()) bal = balDoc.data().balance || 0;
      const delta = data.type === 'deposit' ? data.amount : -data.amount;
      const newBal = bal + delta;
      t.update(txRef, { status: 'approved', approvedBy: uid, approvedAt: serverTimestamp() });
      t.set(balRef, { balance: newBal, updatedAt: serverTimestamp() }, { merge: true });
    });

    alert('Transaksi approved.');
  } catch (e) {
    console.error('Approve error', e);
    alert('Gagal approve transaksi: ' + (e.message || e.code));
  }
}
