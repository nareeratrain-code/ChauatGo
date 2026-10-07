// ==========================================
// 1. Import Firebase SDK (ใช้ CDN สำหรับ Static Site)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================
// 2. Firebase Configuration (ใส่ค่าจริงของคุณแล้ว)
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyB6PnikectfjjYfvO7VhpuxEIXQdJeASBM",
    authDomain: "chauat-go-b9841.firebaseapp.com",
    projectId: "chauat-go-b9841",
    storageBucket: "chauat-go-b9841.firebasestorage.app",
    messagingSenderId: "282197694521",
    appId: "1:282197694521:web:0528c22747a0c04bd815e8",
    measurementId: "G-6E2QEFWK6P"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ==========================================
// 🪟 Debug Console Function (โชว์ Error บนมือถือ)
// ==========================================
window.logToScreen = function(msg, isError = false) {
    const el = document.getElementById('debugConsole');
    if (el) {
        el.style.display = 'block';
        el.innerHTML += `<span style="color:${isError ? '#ff4444' : '#00ff00'}">> ${msg}</span><br>`;
        el.scrollTop = el.scrollHeight;
    }
    console.log(msg);
};

let currentMerchantId = null;
let unsubscribeOrders = null;
let unsubscribeMenus = null;
let currentOrders = [];

// ==========================================
// 3. Auth Guard (ตรวจสอบสิทธิ์)
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        logToScreen("🔑 ล็อกอินด้วย UID: " + user.uid);
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (!userDoc.exists()) {
                throw new Error("ไม่พบ Document ของคุณใน Collection 'users' (UID ไม่ตรงหรือยังไม่ได้สร้าง)");
            }
            const userData = userDoc.data();
            logToScreen("📄 ข้อมูล Role: " + userData.role);

            if (userData.role === 'merchant') {
                currentMerchantId = user.uid;
                document.getElementById('merchantName').innerText = userData.name || "ร้านค้าของฉัน";
                
                document.getElementById('loadingScreen').classList.remove('active');
                document.getElementById('errorScreen').classList.remove('active');
                document.getElementById('dashboardScreen').classList.add('active');
                
                initDashboard();
            } else {
                showError("บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังบ้าน (Role ต้องเป็น merchant)");
            }
        } catch (error) {
            logToScreen("❌ Error: " + error.message, true);
            showError("เกิดข้อผิดพลาด: " + error.message);
        }
    } else {
        logToScreen("⛔ ยังไม่ได้ล็อกอิน กำลังเด้งกลับ index.html", true);
        window.location.href = 'index.html';
    }
});

function showError(msg) {
    document.getElementById('loadingScreen').classList.remove('active');
    document.getElementById('dashboardScreen').classList.remove('active');
    document.getElementById('errorScreen').classList.add('active');
    document.getElementById('errorMessage').innerText = msg;
}

// ==========================================
// 4. ฟังก์ชันหลักของ Dashboard
// ==========================================
function initDashboard() {
    setupNavigation();
    setupEventListeners();
    loadStoreSettings();
    listenToOrders();
    listenToMenus();
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
            item.classList.add('active');
            document.getElementById(item.getAttribute('data-target')).classList.add('active');
        });
    });
}

// ==========================================
// 5. Orders (Real-time)
// ==========================================
function listenToOrders() {
    const ordersList = document.getElementById('ordersList');
    if (unsubscribeOrders) unsubscribeOrders();

    const q = query(collection(db, "orders"), where("merchantId", "==", currentMerchantId), orderBy("createdAt", "desc"));

    unsubscribeOrders = onSnapshot(q, (snapshot) => {
        ordersList.innerHTML = '';
        let stats = { pending: 0, preparing: 0, ready: 0, completed: 0 };
        currentOrders = [];

        if (snapshot.empty) ordersList.innerHTML = '<div class="text-center py-10 text-secondary">ยังไม่มีออเดอร์ในขณะนี้</div>';

        snapshot.forEach((doc) => {
            const order = { id: doc.id, ...doc.data() };
            currentOrders.push(order);
            
            if (order.status === 'pending') stats.pending++;
            else if (order.status === 'preparing') stats.preparing++;
            else if (order.status === 'ready_for_pickup') stats.ready++;
            else if (order.status === 'delivered') stats.completed++;

            const card = document.createElement('div');
            card.className = 'order-card';
            const statusMap = {
                'pending': '<span class="status-badge status-pending">🟡 รอยืนยัน</span>',
                'preparing': '<span class="status-badge status-preparing">🟠 กำลังทำ</span>',
                'ready_for_pickup': '<span class="status-badge status-ready">🔵 รอไรเดอร์</span>',
                'delivered': '<span class="status-badge status-completed">🟢 สำเร็จ</span>'
            };

            card.innerHTML = `
                <div class="order-card-header"><span>#${doc.id.slice(-6).toUpperCase()}</span><span class="text-primary">฿${order.totalPrice || 0}</span></div>
                <div class="order-meta"><span><i class="fas fa-user"></i> ${order.customerName || 'ลูกค้า'}</span><span>${statusMap[order.status] || order.status}</span></div>
                <div class="order-actions">
                    <button onclick="openOrderModal('${doc.id}')" class="btn btn-secondary btn-sm"><i class="fas fa-eye"></i> ดูรายละเอียด</button>
                    ${order.status === 'pending' ? `<button onclick="updateOrderStatus('${doc.id}', 'preparing')" class="btn btn-primary btn-sm">รับออเดอร์</button>` : ''}
                    ${order.status === 'preparing' ? `<button onclick="updateOrderStatus('${doc.id}', 'ready_for_pickup')" class="btn btn-primary btn-sm" style="background:var(--warning)">ทำเสร็จ</button>` : ''}
                </div>`;
            ordersList.appendChild(card);
        });

        document.getElementById('statNewOrders').innerText = stats.pending;
        document.getElementById('statPreparing').innerText = stats.preparing;
        document.getElementById('statReady').innerText = stats.ready;
        document.getElementById('statCompleted').innerText = stats.completed;

        const badge = document.getElementById('orderBadge');
        if (stats.pending > 0) { badge.innerText = stats.pending; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');

    }, (error) => {
        logToScreen("❌ Error Orders: " + error.message, true);
        if (error.message.includes("index")) ordersList.innerHTML = `<div class="text-center text-danger py-4">⚠️ ต้องการสร้าง Index ใน Firestore (คลิกที่ลิงก์ใน Console)</div>`;
    });
}

window.openOrderModal = (orderId) => {
    const order = currentOrders.find(o => o.id === orderId);
    if (!order) return;
    document.getElementById('modalOrderId').innerText = orderId.slice(-6).toUpperCase();
    
    let itemsHtml = order.items ? order.items.map(item => `<div class="flex-between mb-2"><span>${item.name} x${item.qty}</span> <span>฿${item.price * item.qty}</span></div>`).join('') : '<p>ไม่มีข้อมูลรายการอาหาร</p>';

    document.getElementById('modalOrderContent').innerHTML = `
        <div class="mb-4"><p><strong>ลูกค้า:</strong> ${order.customerName || 'ไม่ระบุ'}</p><p><strong>เบอร์:</strong> ${order.customerPhone || 'ไม่ระบุ'}</p><p><strong>ที่อยู่:</strong> ${order.deliveryAddress || 'ไม่ระบุ'}</p></div>
        <div class="mb-4"><h4 class="mb-2 border-b pb-2">รายการอาหาร</h4>${itemsHtml}</div>
        <div class="flex-between border-t pt-4 mt-4"><strong>ยอดรวมทั้งหมด</strong><strong class="text-primary">฿${order.totalPrice || 0}</strong></div>`;

    let actionsHtml = '';
    if (order.status === 'pending') actionsHtml = `<button class="btn btn-danger" onclick="updateOrderStatus('${orderId}', 'cancelled')">ยกเลิก</button><button class="btn btn-primary" onclick="updateOrderStatus('${orderId}', 'preparing')">รับออเดอร์</button>`;
    else if (order.status === 'preparing') actionsHtml = `<button class="btn btn-primary" style="background:var(--warning)" onclick="updateOrderStatus('${orderId}', 'ready_for_pickup')">ทำเสร็จแล้ว</button>`;
    else actionsHtml = `<button class="btn btn-secondary" onclick="closeModal('orderModal')">ปิด</button>`;
    document.getElementById('modalOrderActions').innerHTML = actionsHtml;
    document.getElementById('orderModal').classList.add('active');
};

window.updateOrderStatus = async (orderId, newStatus) => {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus, updatedAt: serverTimestamp() });
        showToast('อัปเดตสถานะสำเร็จ', 'success');
        closeModal('orderModal');
    } catch (error) { showToast("ไม่สามารถอัปเดตได้: " + error.message, 'error'); }
};

// ==========================================
// 6. Menus (Real-time)
// ==========================================
function listenToMenus() {
    const menuList = document.getElementById('menuList');
    if (unsubscribeMenus) unsubscribeMenus();

    const q = query(collection(db, "menus"), where("merchantId", "==", currentMerchantId));
    unsubscribeMenus = onSnapshot(q, (snapshot) => {
        menuList.innerHTML = '';
        if (snapshot.empty) { menuList.innerHTML = '<div class="text-center py-10 text-secondary">ยังไม่มีเมนูในระบบ</div>'; return; }

        snapshot.forEach((doc) => {
            const menu = doc.data();
            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div class="flex-between">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <img src="${menu.imageUrl || 'https://via.placeholder.com/50'}" style="width:50px; height:50px; border-radius:8px; object-fit:cover;">
                        <div><h4>${menu.name}</h4><p class="text-primary font-bold">฿${menu.price}</p><small class="text-secondary">${menu.category === 'food' ? '🍔 อาหาร' : menu.category === 'drink' ? '🥤 เครื่องดื่ม' : '🍰 ของหวาน'}</small></div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <button onclick="editMenu('${doc.id}')" class="btn btn-secondary btn-sm"><i class="fas fa-edit"></i> แก้ไข</button>
                        <button onclick="deleteMenu('${doc.id}')" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i> ลบ</button>
                    </div>
                </div>`;
            menuList.appendChild(card);
        });
    });
}

window.editMenu = (menuId) => {
    getDoc(doc(db, "menus", menuId)).then((docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('formTitle').innerHTML = '<i class="fas fa-edit"></i> แก้ไขเมนู';
            document.getElementById('menuIdInput').value = menuId;
            document.getElementById('menuNameInput').value = data.name;
            document.getElementById('menuPriceInput').value = data.price;
            document.getElementById('menuCategoryInput').value = data.category || 'food';
            document.getElementById('menuDescInput').value = data.description || '';
            document.getElementById('menuImageInput').value = data.imageUrl || '';
            document.getElementById('menuModal').classList.add('active');
        }
    });
};

window.deleteMenu = async (menuId) => {
    if (!confirm("คุณต้องการลบเมนูนี้ใช่หรือไม่?")) return;
    try { await deleteDoc(doc(db, "menus", menuId)); showToast("ลบเมนูสำเร็จ", "success"); } 
    catch (error) { showToast("ลบไม่สำเร็จ: " + error.message, "error"); }
};

// ==========================================
// 7. Store Settings
// ==========================================
async function loadStoreSettings() {
    try {
        const docSnap = await getDoc(doc(db, "merchants", currentMerchantId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('shopNameInput').value = data.shopName || '';
            document.getElementById('shopAddressInput').value = data.address || '';
            document.getElementById('shopPhoneInput').value = data.phone || '';
            const isOpen = data.isOpen !== false;
            document.getElementById('storeStatusToggle').checked = isOpen;
            updateStoreStatusUI(isOpen);
        }
    } catch (error) { logToScreen("❌ Error Settings: " + error.message, true); }
}

function updateStoreStatusUI(isOpen) {
    const statusText = document.getElementById('storeStatusText');
    statusText.innerHTML = isOpen ? '<i class="fas fa-circle"></i> เปิดร้าน' : '<i class="fas fa-circle"></i> ปิดร้าน';
    statusText.className = isOpen ? 'status-open' : 'status-closed';
}

// ==========================================
// 8. Event Listeners
// ==========================================
function setupEventListeners() {
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        try {
            await setDoc(doc(db, "merchants", currentMerchantId), {
                shopName: document.getElementById('shopNameInput').value,
                address: document.getElementById('shopAddressInput').value,
                phone: document.getElementById('shopPhoneInput').value,
                ownerId: currentMerchantId
            }, { merge: true });
            showToast("บันทึกการตั้งค่าสำเร็จ", "success");
        } catch (error) { showToast("บันทึกไม่สำเร็จ: " + error.message, "error"); }
    });

    document.getElementById('storeStatusToggle').addEventListener('change', async (e) => {
        const isOpen = e.target.checked; updateStoreStatusUI(isOpen);
        try { await updateDoc(doc(db, "merchants", currentMerchantId), { isOpen }); showToast(isOpen ? "เปิดร้านแล้ว" : "ปิดร้านแล้ว", "success"); } 
        catch (error) { logToScreen("Error updating status", true); }
    });

    document.getElementById('addMenuBtn').addEventListener('click', () => {
        document.getElementById('formTitle').innerHTML = '<i class="fas fa-plus"></i> เพิ่มเมนูใหม่';
        document.getElementById('menuIdInput').value = '';
        document.getElementById('menuNameInput').value = '';
        document.getElementById('menuPriceInput').value = '';
        document.getElementById('menuCategoryInput').value = 'food';
        document.getElementById('menuDescInput').value = '';
        document.getElementById('menuImageInput').value = '';
        document.getElementById('menuModal').classList.add('active');
    });

    document.getElementById('saveMenuBtn').addEventListener('click', async () => {
        const menuId = document.getElementById('menuIdInput').value;
        const name = document.getElementById('menuNameInput').value;
        const price = parseFloat(document.getElementById('menuPriceInput').value);
        if (!name || !price || price <= 0) { showToast("กรุณากรอกชื่อเมนูและราคาให้ถูกต้อง", "warning"); return; }

        const menuData = { merchantId: currentMerchantId, name, price, category: document.getElementById('menuCategoryInput').value, description: document.getElementById('menuDescInput').value, imageUrl: document.getElementById('menuImageInput').value, updatedAt: serverTimestamp() };

        try {
            if (menuId) { await updateDoc(doc(db, "menus", menuId), menuData); showToast("แก้ไขเมนูสำเร็จ", "success"); } 
            else { menuData.createdAt = serverTimestamp(); await addDoc(collection(db, "menus"), menuData); showToast("เพิ่มเมนูสำเร็จ", "success"); }
            closeModal('menuModal');
        } catch (error) { showToast("บันทึกไม่สำเร็จ: " + error.message, "error"); }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (unsubscribeOrders) unsubscribeOrders();
        if (unsubscribeMenus) unsubscribeMenus();
        signOut(auth).then(() => window.location.href = 'index.html');
    });
}

window.closeModal = (modalId) => document.getElementById(modalId).classList.remove('active');
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'error' ? 'fa-times-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-check-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}