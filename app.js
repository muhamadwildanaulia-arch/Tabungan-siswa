import { auth, db } from './__firebase_shim__.js'; // shim replaced at runtime
// Because index.html already attached firebase to window.__FIREBASE, we'll reference that
const { auth: _auth, db: _db } = window.__FIREBASE;

const $ = sel => document.querySelector(sel);
// Auth elements
const emailInput = $('#email');
const passInput = $('#password');
const btnLogin = $('#btn-login');
const btnRegister = $('#btn-register');
const btnLogout = $('#btn-logout');
const userInfo = $('#user-info');
const userEmail = $('#user-email');

// App elements
const appSection = $('#app');
const studentSelect = $('#student-select');
const amountInput = $('#amount');
const typeSelect = $('#type');
const noteInput = $('#note');
const btnSubmit = $('#btn-submit');
const balanceSpan = $('#balance');
const txList = $('#tx-list');
const pendingList = $('#pending-list');

// Simple helpers
function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

btnLogin.onclick = async () => {
  try {
    await import('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js');
    await _auth && null;
    await signIn();
  } catch (e) {
    console.error(e);
  }
};

btnRegister.onclick = async () => {
  try {
    await register();
  } catch (e) { console.error(e); }
};

btnLogout.onclick = async () => {
  await window.__FIREBASE.auth.signOut();
};

async function signIn() {
  const email = emailInput.value;
  const password = passInput.value;
  try {
    await window.__FIREBASE.auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    alert('Login gagal: ' + e.message);
  }
}

async function register() {
  const email = emailInput.value;
  const password = passInput.value;
  try {
    const cred = await window.__FIREBASE.auth.createUserWithEmailAndPassword(email, password);
    // create user doc with default role 'student'
    await window.__FIREBASE.db.collection('users').doc(cred.user.uid).set({ email, role: 'student' });
    alert('Registrasi berhasil. Silakan login.');
  } catch (e) {
    alert('Register gagal: ' + e.message);
  }
}

// Replace older compat calls with modular equivalents when moving to build tooling.

// Auth state
window.__FIREBASE.auth.onAuthStateChanged(async user => {
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

async function loadStudents() {
  // load students collection into select
  const snap = await window.__FIREBASE.db.collection('students').get();
  studentSelect.innerHTML = '';
  snap.forEach(doc => {
    const d = doc.data();
    const opt = document.createElement('option');
    opt.value = doc.id;
    opt.textContent = d.nis + ' — ' + d.name + (d.class ? ' (' + d.class + ')' : '');
    studentSelect.appendChild(opt);
  });
  updateBalanceForSelected();
}

studentSelect.onchange = updateBalanceForSelected;

async function updateBalanceForSelected() {
  const sid = studentSelect.value;
  if (!sid) return;
  const bdoc = await window.__FIREBASE.db.collection('balances').doc(sid).get();
  if (bdoc.exists) balanceSpan.textContent = formatCurrency(bdoc.data().balance);
  else balanceSpan.textContent = formatCurrency(0);
}

function formatCurrency(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

btnSubmit.onclick = async () => {
  const sid = studentSelect.value;
  const amount = Number(amountInput.value);
  const type = typeSelect.value;
  const note = noteInput.value || '';
  if (!sid || !amount || amount <= 0) return alert('Pilih siswa & masukkan jumlah yang valid.');

  // create pending transaction
  try {
    await window.__FIREBASE.db.collection('transactions').add({
      studentId: sid,
      amount: amount,
      type: type,
      note: note,
      status: 'pending',
      createdAt: new Date(),
      createdBy: window.__FIREBASE.auth.currentUser.uid
    });
    alert('Transaksi dikirim untuk verifikasi.');
  } catch (e) {
    console.error(e);
    alert('Gagal membuat transaksi.');
  }
}

function subscribeTransactions() {
  // realtime list of transactions for current user
  window.__FIREBASE.db.collection('transactions').orderBy('createdAt', 'desc').limit(50).onSnapshot(snap => {
    txList.innerHTML = '';
    pendingList.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const li = document.createElement('li');
      li.textContent = `${d.type} ${formatCurrency(d.amount)} — ${d.note || '-'} [${d.status}]`;
      txList.appendChild(li);
      if (d.status === 'pending') {
        const pli = document.createElement('li');
        pli.textContent = `${d.studentId}: ${d.type} ${formatCurrency(d.amount)}`;
        // approve button (only shown if user is admin) - naive check: read users collection
        const btnApprove = document.createElement('button');
        btnApprove.textContent = 'Approve';
        btnApprove.onclick = async () => await approveTx(doc.id, d);
        pli.appendChild(btnApprove);
        pendingList.appendChild(pli);
      }
    });
  });
}

async function approveTx(txId, data) {
  // naive admin check
  const uid = window.__FIREBASE.auth.currentUser.uid;
  const userDoc = await window.__FIREBASE.db.collection('users').doc(uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') return alert('Hanya admin yang bisa approve.');

  // transaction - update transaction status and update balance in a simple way
  const txRef = window.__FIREBASE.db.collection('transactions').doc(txId);
  const balRef = window.__FIREBASE.db.collection('balances').doc(data.studentId);

  try {
    await window.__FIREBASE.db.runTransaction(async t => {
      const balDoc = await t.get(balRef);
      let bal = 0;
      if (balDoc.exists) bal = balDoc.data().balance;
      const delta = data.type === 'deposit' ? data.amount : -data.amount;
      const newBal = bal + delta;
      t.update(txRef, { status: 'approved', approvedBy: uid, approvedAt: new Date() });
      t.set(balRef, { balance: newBal, updatedAt: new Date() });
    });
    alert('Transaksi approved.');
  } catch (e) {
    console.error(e);
    alert('Gagal approve: ' + e.message);
  }
}
