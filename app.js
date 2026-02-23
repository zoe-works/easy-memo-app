// ============================================
// CloudMemo — Firebase連携メモアプリ
// ============================================

// ★★★ Firebase設定 ★★★
// Firebase Console → プロジェクト設定 → Webアプリ から取得した値をここに貼り付けてください
const firebaseConfig = {
    apiKey: "AIzaSyACkMr6aAIpXvqUwY3KIs8khXLeF3QB6Bk",
    authDomain: "memoapp-7dc80.firebaseapp.com",
    projectId: "memoapp-7dc80",
    storageBucket: "memoapp-7dc80.firebasestorage.app",
    messagingSenderId: "992624982611",
    appId: "1:992624982611:web:1caa871cf029a4f41ea4a6",
    measurementId: "G-TM6FDLP5W8"
};

// Firebase 初期化
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============================================
// State
// ============================================
let currentUser = null;
let currentMemoId = null;
let currentCategory = 'all'; // 'all' = すべて
let memos = [];
let categories = [];
let searchQuery = '';
let saveTimeout = null;
let unsubscribeMemos = null;
let unsubscribeCategories = null;

// ============================================
// DOM Elements
// ============================================
const $ = (id) => document.getElementById(id);

const DOM = {
    loadingOverlay: $('loadingOverlay'),
    toastContainer: $('toastContainer'),
    loginScreen: $('loginScreen'),
    appContainer: $('appContainer'),
    btnGoogleLogin: $('btnGoogleLogin'),
    btnLogout: $('btnLogout'),
    btnMenu: $('btnMenu'),
    btnNewMemo: $('btnNewMemo'),
    btnDeleteMemo: $('btnDeleteMemo'),
    btnBackToList: $('btnBackToList'),
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebarOverlay'),
    categoryList: $('categoryList'),
    addCategoryForm: $('addCategoryForm'),
    newCategoryInput: $('newCategoryInput'),
    userAvatar: $('userAvatar'),
    userName: $('userName'),
    userEmail: $('userEmail'),
    searchInput: $('searchInput'),
    memoListTitle: $('memoListTitle'),
    memoListCount: $('memoListCount'),
    memoList: $('memoList'),
    memoListPanel: $('memoListPanel'),
    memoEditorPanel: $('memoEditorPanel'),
    editorEmpty: $('editorEmpty'),
    editorContent: $('editorContent'),
    editorTitle: $('editorTitle'),
    editorTextarea: $('editorTextarea'),
    editorCategory: $('editorCategory'),
    editorMeta: $('editorMeta'),
    saveStatus: $('saveStatus'),
    saveStatusText: $('saveStatusText'),
    deleteDialog: $('deleteDialog'),
    btnCancelDelete: $('btnCancelDelete'),
    btnConfirmDelete: $('btnConfirmDelete'),
    deleteCategoryDialog: $('deleteCategoryDialog'),
    btnCancelDeleteCategory: $('btnCancelDeleteCategory'),
    btnConfirmDeleteCategory: $('btnConfirmDeleteCategory'),
};

// ============================================
// Auth
// ============================================
auth.onAuthStateChanged((user) => {
    DOM.loadingOverlay.classList.add('hidden');

    if (user) {
        currentUser = user;
        showApp();
        setupRealtimeListeners();
    } else {
        currentUser = null;
        showLogin();
        cleanupListeners();
    }
});

function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((error) => {
        console.error('Login error:', error);
        showToast('ログインに失敗しました: ' + error.message, 'error');
    });
}

function signOut() {
    auth.signOut().catch((error) => {
        console.error('Logout error:', error);
        showToast('ログアウトに失敗しました', 'error');
    });
}

// ============================================
// UI State
// ============================================
function showLogin() {
    DOM.loginScreen.classList.remove('hidden');
    DOM.appContainer.classList.add('hidden');
}

function showApp() {
    DOM.loginScreen.classList.add('hidden');
    DOM.appContainer.classList.remove('hidden');

    // ユーザー情報を表示
    DOM.userAvatar.src = currentUser.photoURL || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%237c5cf5"/><text x="50" y="55" text-anchor="middle" dy=".1em" font-size="40" fill="white">' + (currentUser.displayName?.[0] || '?') + '</text></svg>';
    DOM.userName.textContent = currentUser.displayName || 'ユーザー';
    DOM.userEmail.textContent = currentUser.email || '';
}

// ============================================
// Firestore — Realtime Listeners
// ============================================
function setupRealtimeListeners() {
    const userId = currentUser.uid;

    // メモのリアルタイムリスナー
    unsubscribeMemos = db.collection('users').doc(userId)
        .collection('memos')
        .orderBy('updatedAt', 'desc')
        .onSnapshot((snapshot) => {
            memos = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderMemoList();
            // 現在編集中のメモが更新された場合は内容を反映
            if (currentMemoId) {
                const currentMemo = memos.find(m => m.id === currentMemoId);
                if (!currentMemo) {
                    // 削除された場合
                    closeEditor();
                } else {
                    // 別デバイスからの変更を反映（自分が入力中でなければ）
                    const titleEl = DOM.editorTitle;
                    const textareaEl = DOM.editorTextarea;
                    const isTyping = document.activeElement === titleEl || document.activeElement === textareaEl;
                    if (!isTyping) {
                        titleEl.value = currentMemo.title || '';
                        textareaEl.value = currentMemo.content || '';
                        DOM.editorCategory.value = currentMemo.category || '未分類';
                        DOM.editorMeta.textContent = `作成: ${formatDate(currentMemo.createdAt)} ・ 更新: ${formatDate(currentMemo.updatedAt)}`;
                    }
                }
            }
        }, (error) => {
            console.error('Memos listener error:', error);
            showToast('メモの読み込みに失敗しました', 'error');
        });

    // カテゴリのリアルタイムリスナー
    unsubscribeCategories = db.collection('users').doc(userId)
        .collection('categories')
        .orderBy('name')
        .onSnapshot((snapshot) => {
            categories = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderCategories();
            updateEditorCategorySelect();
        }, (error) => {
            console.error('Categories listener error:', error);
        });
}

function cleanupListeners() {
    if (unsubscribeMemos) unsubscribeMemos();
    if (unsubscribeCategories) unsubscribeCategories();
    unsubscribeMemos = null;
    unsubscribeCategories = null;
}

// ============================================
// Memos — CRUD
// ============================================
async function createMemo() {
    try {
        const userId = currentUser.uid;
        const now = firebase.firestore.FieldValue.serverTimestamp();
        const newMemo = {
            title: '',
            content: '',
            category: currentCategory === 'all' ? '未分類' : currentCategory,
            createdAt: now,
            updatedAt: now,
        };

        const docRef = await db.collection('users').doc(userId)
            .collection('memos').add(newMemo);

        currentMemoId = docRef.id;

        // エディタを開く（リアルタイムリスナーがリストを更新するのを待つ）
        setTimeout(() => {
            openEditor(docRef.id);
            DOM.editorTitle.focus();
        }, 300);

        showToast('新しいメモを作成しました', 'success');
    } catch (error) {
        console.error('Create memo error:', error);
        showToast('メモの作成に失敗しました', 'error');
    }
}

function saveMemo() {
    if (!currentMemoId) return;

    // デバウンス：入力が止まってから500ms後に保存
    clearTimeout(saveTimeout);
    updateSaveStatus('saving');

    saveTimeout = setTimeout(async () => {
        try {
            const userId = currentUser.uid;
            await db.collection('users').doc(userId)
                .collection('memos').doc(currentMemoId).update({
                    title: DOM.editorTitle.value,
                    content: DOM.editorTextarea.value,
                    category: DOM.editorCategory.value,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            updateSaveStatus('saved');
        } catch (error) {
            console.error('Save memo error:', error);
            updateSaveStatus('error');
            showToast('保存に失敗しました', 'error');
        }
    }, 500);
}

async function deleteMemo(memoId) {
    try {
        const userId = currentUser.uid;
        await db.collection('users').doc(userId)
            .collection('memos').doc(memoId).delete();

        if (currentMemoId === memoId) {
            closeEditor();
        }

        showToast('メモを削除しました', 'info');
    } catch (error) {
        console.error('Delete memo error:', error);
        showToast('削除に失敗しました', 'error');
    }
}

// ============================================
// Categories — CRUD
// ============================================
async function addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) return;

    // 重複チェック
    if (categories.some(c => c.name === trimmed) || trimmed === 'すべて' || trimmed === '未分類') {
        showToast('このカテゴリは既に存在します', 'error');
        return;
    }

    try {
        const userId = currentUser.uid;
        await db.collection('users').doc(userId)
            .collection('categories').add({ name: trimmed });
        showToast(`「${trimmed}」カテゴリを追加しました`, 'success');
    } catch (error) {
        console.error('Add category error:', error);
        showToast('カテゴリの追加に失敗しました', 'error');
    }
}

let categoryToDelete = null;

async function deleteCategory(categoryId, categoryName) {
    try {
        const userId = currentUser.uid;

        // このカテゴリに属するメモを「未分類」に変更
        const memosInCategory = memos.filter(m => m.category === categoryName);
        const batch = db.batch();

        memosInCategory.forEach(memo => {
            const memoRef = db.collection('users').doc(userId).collection('memos').doc(memo.id);
            batch.update(memoRef, { category: '未分類' });
        });

        // カテゴリを削除
        const categoryRef = db.collection('users').doc(userId).collection('categories').doc(categoryId);
        batch.delete(categoryRef);

        await batch.commit();

        if (currentCategory === categoryName) {
            currentCategory = 'all';
        }

        showToast(`「${categoryName}」カテゴリを削除しました`, 'info');
    } catch (error) {
        console.error('Delete category error:', error);
        showToast('カテゴリの削除に失敗しました', 'error');
    }
}

// ============================================
// Rendering
// ============================================
function renderCategories() {
    const allCount = memos.length;
    const uncategorizedCount = memos.filter(m => m.category === '未分類').length;

    let html = `
    <li class="category-item ${currentCategory === 'all' ? 'active' : ''}" data-category="all">
      <span class="category-name">📋 すべて</span>
      <span class="category-count">${allCount}</span>
    </li>
    <li class="category-item ${currentCategory === '未分類' ? 'active' : ''}" data-category="未分類">
      <span class="category-name">📁 未分類</span>
      <span class="category-count">${uncategorizedCount}</span>
    </li>
  `;

    categories.forEach(cat => {
        const count = memos.filter(m => m.category === cat.name).length;
        html += `
      <li class="category-item ${currentCategory === cat.name ? 'active' : ''}" data-category="${escapeHtml(cat.name)}">
        <span class="category-name">🏷️ ${escapeHtml(cat.name)}</span>
        <span class="category-count">${count}</span>
        <button class="btn-delete-category" data-category-id="${cat.id}" data-category-name="${escapeHtml(cat.name)}" title="カテゴリを削除">✕</button>
      </li>
    `;
    });

    DOM.categoryList.innerHTML = html;

    // カテゴリクリックイベント
    DOM.categoryList.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-category')) return;
            currentCategory = item.dataset.category;
            renderCategories();
            renderMemoList();
            updateMemoListTitle();
            closeSidebar();
        });
    });

    // カテゴリ削除ボタン
    DOM.categoryList.querySelectorAll('.btn-delete-category').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            categoryToDelete = {
                id: btn.dataset.categoryId,
                name: btn.dataset.categoryName
            };
            DOM.deleteCategoryDialog.classList.remove('hidden');
        });
    });
}

function renderMemoList() {
    let filtered = [...memos];

    // カテゴリフィルタ
    if (currentCategory !== 'all') {
        filtered = filtered.filter(m => m.category === currentCategory);
    }

    // 検索フィルタ
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(m =>
            (m.title || '').toLowerCase().includes(q) ||
            (m.content || '').toLowerCase().includes(q)
        );
    }

    DOM.memoListCount.textContent = filtered.length;

    if (filtered.length === 0) {
        DOM.memoList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${searchQuery ? '🔍' : '📄'}</div>
        <h3>${searchQuery ? '見つかりません' : 'メモがありません'}</h3>
        <p>${searchQuery ? '検索条件を変更してみてください' : '「＋ 新規メモ」ボタンでメモを作成しましょう'}</p>
      </div>
    `;
        return;
    }

    let html = '';
    filtered.forEach(memo => {
        const title = memo.title || '無題のメモ';
        const preview = memo.content || 'メモの内容がありません...';
        const date = formatDate(memo.updatedAt);
        const isActive = memo.id === currentMemoId;

        html += `
      <div class="memo-item ${isActive ? 'active' : ''}" data-memo-id="${memo.id}">
        <div class="memo-item-title">${escapeHtml(title)}</div>
        <div class="memo-item-preview">${escapeHtml(preview)}</div>
        <div class="memo-item-meta">
          <span class="memo-item-category">🏷️ ${escapeHtml(memo.category || '未分類')}</span>
          <span>${date}</span>
        </div>
      </div>
    `;
    });

    DOM.memoList.innerHTML = html;

    // メモクリックイベント
    DOM.memoList.querySelectorAll('.memo-item').forEach(item => {
        item.addEventListener('click', () => {
            openEditor(item.dataset.memoId);
        });
    });
}

function updateMemoListTitle() {
    if (currentCategory === 'all') {
        DOM.memoListTitle.textContent = 'すべてのメモ';
    } else {
        DOM.memoListTitle.textContent = currentCategory;
    }
}

function updateEditorCategorySelect() {
    let html = '<option value="未分類">未分類</option>';
    categories.forEach(cat => {
        html += `<option value="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</option>`;
    });
    DOM.editorCategory.innerHTML = html;

    // 現在編集中のメモのカテゴリを選択
    if (currentMemoId) {
        const memo = memos.find(m => m.id === currentMemoId);
        if (memo) {
            DOM.editorCategory.value = memo.category || '未分類';
        }
    }
}

// ============================================
// Editor
// ============================================
function openEditor(memoId) {
    currentMemoId = memoId;
    const memo = memos.find(m => m.id === memoId);
    if (!memo) return;

    DOM.editorEmpty.classList.add('hidden');
    DOM.editorContent.classList.remove('hidden');

    DOM.editorTitle.value = memo.title || '';
    DOM.editorTextarea.value = memo.content || '';
    DOM.editorCategory.value = memo.category || '未分類';
    DOM.editorMeta.textContent = `作成: ${formatDate(memo.createdAt)} ・ 更新: ${formatDate(memo.updatedAt)}`;

    updateSaveStatus('');

    // アクティブなメモをハイライト
    DOM.memoList.querySelectorAll('.memo-item').forEach(item => {
        item.classList.toggle('active', item.dataset.memoId === memoId);
    });

    // モバイル: エディタを全画面表示
    if (window.innerWidth < 768) {
        DOM.memoEditorPanel.classList.add('active-mobile');
    }
}

function closeEditor() {
    currentMemoId = null;
    DOM.editorEmpty.classList.remove('hidden');
    DOM.editorContent.classList.add('hidden');

    // モバイル: メモリストに戻る
    DOM.memoEditorPanel.classList.remove('active-mobile');

    // アクティブ解除
    DOM.memoList.querySelectorAll('.memo-item').forEach(item => {
        item.classList.remove('active');
    });
}

function updateSaveStatus(status) {
    DOM.saveStatus.className = 'save-status';
    if (status === 'saving') {
        DOM.saveStatus.classList.add('saving');
        DOM.saveStatusText.textContent = '保存中...';
    } else if (status === 'saved') {
        DOM.saveStatus.classList.add('saved');
        DOM.saveStatusText.textContent = '✓ 保存済み';
        setTimeout(() => {
            if (DOM.saveStatusText.textContent === '✓ 保存済み') {
                DOM.saveStatusText.textContent = '';
            }
        }, 2000);
    } else if (status === 'error') {
        DOM.saveStatusText.textContent = '⚠ 保存失敗';
    } else {
        DOM.saveStatusText.textContent = '';
    }
}

// ============================================
// Sidebar (mobile)
// ============================================
function openSidebar() {
    DOM.sidebar.classList.add('open');
    DOM.sidebarOverlay.classList.add('active');
}

function closeSidebar() {
    DOM.sidebar.classList.remove('open');
    DOM.sidebarOverlay.classList.remove('active');
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Utilities
// ============================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    // 1分以内
    if (diff < 60000) return 'たった今';
    // 1時間以内
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分前`;
    // 24時間以内
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}時間前`;
    // 7日以内
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}日前`;

    // それ以外
    return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// ============================================
// Event Listeners
// ============================================
function initEventListeners() {
    // Auth
    DOM.btnGoogleLogin.addEventListener('click', signInWithGoogle);
    DOM.btnLogout.addEventListener('click', signOut);

    // Sidebar
    DOM.btnMenu.addEventListener('click', openSidebar);
    DOM.sidebarOverlay.addEventListener('click', closeSidebar);

    // New Memo
    DOM.btnNewMemo.addEventListener('click', createMemo);

    // Search
    DOM.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderMemoList();
    });

    // Add Category
    DOM.addCategoryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = DOM.newCategoryInput.value.trim();
        if (name) {
            addCategory(name);
            DOM.newCategoryInput.value = '';
        }
    });

    // Editor — Auto-save
    DOM.editorTitle.addEventListener('input', saveMemo);
    DOM.editorTextarea.addEventListener('input', saveMemo);
    DOM.editorCategory.addEventListener('change', saveMemo);

    // Delete Memo
    DOM.btnDeleteMemo.addEventListener('click', () => {
        if (currentMemoId) {
            DOM.deleteDialog.classList.remove('hidden');
        }
    });

    DOM.btnCancelDelete.addEventListener('click', () => {
        DOM.deleteDialog.classList.add('hidden');
    });

    DOM.btnConfirmDelete.addEventListener('click', () => {
        if (currentMemoId) {
            deleteMemo(currentMemoId);
        }
        DOM.deleteDialog.classList.add('hidden');
    });

    // Delete Category
    DOM.btnCancelDeleteCategory.addEventListener('click', () => {
        DOM.deleteCategoryDialog.classList.add('hidden');
        categoryToDelete = null;
    });

    DOM.btnConfirmDeleteCategory.addEventListener('click', () => {
        if (categoryToDelete) {
            deleteCategory(categoryToDelete.id, categoryToDelete.name);
        }
        DOM.deleteCategoryDialog.classList.add('hidden');
        categoryToDelete = null;
    });

    // Back to list (mobile)
    DOM.btnBackToList.addEventListener('click', () => {
        closeEditor();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+N or Cmd+N — 新規メモ
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            if (currentUser) createMemo();
        }
        // Escape — ダイアログ閉じる
        if (e.key === 'Escape') {
            DOM.deleteDialog.classList.add('hidden');
            DOM.deleteCategoryDialog.classList.add('hidden');
            closeSidebar();
        }
    });

    // ダイアログのオーバーレイクリックで閉じる
    DOM.deleteDialog.addEventListener('click', (e) => {
        if (e.target === DOM.deleteDialog) {
            DOM.deleteDialog.classList.add('hidden');
        }
    });

    DOM.deleteCategoryDialog.addEventListener('click', (e) => {
        if (e.target === DOM.deleteCategoryDialog) {
            DOM.deleteCategoryDialog.classList.add('hidden');
            categoryToDelete = null;
        }
    });
}

// ============================================
// Initialize
// ============================================
initEventListeners();
