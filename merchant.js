// ==========================================
// 1. Import Firebase SDK
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================
// 2. Firebase Configuration (⚠️ แก้ไขเป็นของคุณ)
// ==========================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "chauat-go.firebaseapp.com",
    projectId: "chauat-go",
    storageBucket: "chauat-go.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ==========================================
// 3. Global Variables & State
// ==========================================
let currentMerchantId = null;
let unsubscribeOrders = null;
let unsubscribeMenus = null;
let currentOrders = []; // เก็บ State ของออเดอร์ปัจจุบัน

// ==========================================
// 4. Utility Functions (Toast, Modal)
// ==========================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-times-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.closeModal = (modalId) => {
    document.getElementById(modalId).classList.remove('active');
};

function playNotificationSound() {
    // ใช้ Web Audio API สร้างเสียงแจ้งเตือน (ไม่ต้องโหลดไฟล์ mp3)
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        oscillator.frequency.setValueAtTime(1108.73, audioCtx.currentTime + 0.1); // C#6
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) { console.log("Audio notification not supported"); }
}

// ==========================================
// 5. Auth Guard (Production Level)
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (!userDoc.exists()) throw new Error("ไม่พบข้อมูลผู้ใช้ในระบบ");

            const userData = userDoc.data();
            if (userData.role === 'merchant') {
                currentMerchantId = user.uid;
                document.getElementById('merchantName').innerText = userData.name || "ร้านค้าของฉัน";
                
                // แสดง Dashboard
                document.getElementById('loadingScreen').classList.remove('active');
                document.getElementById('errorScreen').classList.remove('active');
                document.getElementById('dashboardScreen').classList.add('active');
                
                initDashboard();
            } else {
                showError("บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังบ้าน (ต้องเป็น Role: merchant)");
            }
        } catch (error) {
            console.error("Auth Error:", error);
            showError("ไม่สามารถตรวจสอบสิทธิ์ได้: " + error.message);
        }
    } else {
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
// 6. Initialize Dashboard
// ==========================================
function initDashboard() {
    setupNavigation();
    setupEventListeners();
    loadStoreSettings();
    listenToOrders(); // Real-time orders
    listenToMenus();  // Real-time menus
}

// ==========================================
// 7. Navigation Logic
// ==========================================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.content-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            sections.forEach(sec => sec.classList.remove('active'));
            item.classList.add('active');
            document.getElementById(item.getAttribute('data-target')).classList.add('active');
        });
    });
}

// ==========================================
// 8. Real-time Orders Listener
// ==========================================
function listenToOrders() {
    const ordersList = document.getElementById('ordersList');
    
    if (unsubscribeOrders) unsubscribeOrders();

    // ⚠️ ต้องสร้าง Composite Index: merchantId (Asc) + createdAt (Desc)
    const q = query(
        collection(db, "orders"),
        where("merchantId", "==", currentMerchantId),
        orderBy("createdAt", "desc")
    );

    unsubscribeOrders = onSnapshot(q, (snapshot) => {
        ordersList.innerHTML = '';
        let stats = { pending: 0, preparing: 0, ready: 0, completed: 0 };
        let newOrderCount = 0;
        currentOrders = [];

        if (snapshot.empty) {
            ordersList.innerHTML = '<div class="text-center py-10 text-secondary">ยังไม่มีออเดอร์ในขณะนี้</div>';
        }

        snapshot.forEach((doc) => {
            const order = { id: doc.id, ...doc.data() };
            currentOrders.push(order);
            
            if (order.status === 'pending') { stats.pending++; newOrderCount++; }
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
                <div class="order-card-header">
                    <span>#${doc.id.slice(-6).toUpperCase()}</span>
                    <span class="text-primary">฿${order.totalPrice || 0}</span>
                </div>
                <div class="order-meta">
                    <span><i class="fas fa-user"></i> ${order.customerName || 'ลูกค้า'}</span>
                    <span>${statusMap[order.status] || order.status}</span>
                </div>
                <div class="order-actions">
                    <button onclick="openOrderModal('${doc.id}')" class="btn btn-secondary btn-sm"><i class="fas fa-eye"></i> ดูรายละเอียด</button>
                    ${order.status === 'pending' ? `<button onclick="updateOrderStatus('${doc.id}', 'preparing')" class="btn btn-primary btn-sm"><i class="fas fa-check"></i> รับออเดอร์</button>` : ''}
                    ${order.status === 'preparing' ? `<button onclick="updateOrderStatus('${doc.id}', 'ready_for_pickup')" class="btn btn-primary btn-sm" style="background:var(--warning)"><i class="fas fa-check"></i> ทำเสร็จ</button>` : ''}
                </div>
            `;
            ordersList.appendChild(card);
        });

        // อัปเดต Stats
        document.getElementById('statNewOrders').innerText = stats.pending;
        document.getElementById('statPreparing').innerText = stats.preparing;
        document.getElementById('statReady').innerText = stats.ready;
        document.getElementById('statCompleted').innerText = stats.completed;

        // แจ้งเตือนออเดอร์ใหม่
        const badge = document.getElementById('orderBadge');
        if (newOrderCount > 0) {
            badge.innerText = newOrderCount;
            badge.classList.remove('hidden');
            // เล่นเสียงแจ้งเตือนเมื่อมีออเดอร์ใหม่ (เช็คจากจำนวนที่เพิ่มขึ้น)
            if (window.lastOrderCount !== undefined && newOrderCount > window.lastOrderCount) {
                playNotificationSound();
                showToast('มีออเดอร์ใหม่เข้ามา!', 'warning');
            }
            window.lastOrderCount = newOrderCount;
        } else {
            badge.classList.add('hidden');
            window.lastOrderCount = 0;
        }

    }, (error) => {
        console.error("Error listening to orders:", error);
        if (error.message.includes("index")) {
            ordersList.innerHTML = `<div class="text-center text-danger py-4">⚠️ ต้องการสร้าง Index ใน Firestore (คลิกที่ลิงก์ใน Console)</div>`;
        }
    });
}

// ==========================================
// 9. Order Detail Modal
// ==========================================
window.openOrderModal = (orderId) => {
    const order = currentOrders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('modalOrderId').innerText = orderId.slice(-6).toUpperCase();
    
    let itemsHtml = '';
    if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
            itemsHtml += `<div class="flex-between mb-2"><span>${item.name} x${item.qty}</span> <span>฿${item.price * item.qty}</span></div>`;
        });
    } else {
        itemsHtml = '<p>ไม่มีข้อมูลรายการอาหาร</p>';
    }

    document.getElementById('modalOrderContent').innerHTML = `
        <div class="mb-4">
            <p><strong>ลูกค้า:</strong> ${order.customerName || 'ไม่ระบุ'}</p>
            <p><strong>เบอร์โทร:</strong> ${order.customerPhone || 'ไม่ระบุ'}</p>
            <p><strong>ที่อยู่จัดส่ง:</strong> ${order.deliveryAddress || 'ไม่ระบุ'}</p>
        </div>
        <div class="mb-4">
            <h4 class="mb-2 border-b pb-2">รายการอาหาร</h4>
            ${itemsHtml}
        </div>
        <div class="flex-between border-t pt-4 mt-4">
            <strong>ยอดรวมทั้งหมด</strong>
            <strong class="text-primary">฿${order.totalPrice || 0}</strong>
        </div>
    `;

    // ปุ่ม Actions ใน Modal
    let actionsHtml = '';
    if (order.status === 'pending') {
        actionsHtml = `
            <button class="btn btn-danger" onclick="updateOrderStatus('${orderId}', 'cancelled')">ยกเลิกออเดอร์</button>
            <button class="btn btn-primary" onclick="updateOrderStatus('${orderId}', 'preparing')">รับออเดอร์</button>
        `;
    } else if (order.status === 'preparing') {
        actionsHtml = `<button class="btn btn-primary" style="background:var(--warning)" onclick="updateOrderStatus('${orderId}', 'ready_for_pickup')">ทำเสร็จแล้ว</button>`;
    } else {
        actionsHtml = `<button class="btn btn-secondary" onclick="closeModal('orderModal')">ปิด</button>`;
    }
    document.getElementById('modalOrderActions').innerHTML = actionsHtml;

    document.getElementById('orderModal').classList.add('active');
};

window.updateOrderStatus = async (orderId, newStatus) => {
    try {
        await updateDoc(doc(db, "orders", orderId), { 
            status: newStatus, 
            updatedAt: serverTimestamp() 
        });
        showToast('อัปเดตสถานะสำเร็จ', 'success');
        closeModal('orderModal');
    } catch (error) {
        showToast("ไม่สามารถอัปเดตได้: " + error.message, 'error');
    }
};

// ==========================================
// 10. Real-time Menus Listener
// ==========================================
function listenToMenus() {
    const menuList = document.getElementById('menuList');
    
    if (unsubscribeMenus) unsubscribeMenus();

    const q = query(collection(db, "menus"), where("merchantId", "==", currentMerchantId));

    unsubscribeMenus = onSnapshot(q, (snapshot) => {
        menuList.innerHTML = '';
        if (snapshot.empty) {
            menuList.innerHTML = '<div class="text-center py-10 text-secondary">ยังไม่มีเมนูในระบบ</div>';
            return;
        }

        snapshot.forEach((doc) => {
            const menu = doc.data();
            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div class="flex-between">
                    <div style="display:flex; gap:10px; align-items:center;">
                        <img src="${menu.imageUrl || 'https://via.placeholder.com/50'}" style="width:50px; height:50px; border-radius:8px; object-fit:cover;">
                        <div>
                            <h4>${menu.name}</h4>
                            <p class="text-primary font-bold">฿${menu.price}</p>
                            <small class="text-secondary">${menu.category === 'food' ? '🍔 อาหาร' : menu.category === 'drink' ? '🥤 เครื่องดื่ม' : '🍰 ของหวาน'}</small>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <button onclick="editMenu('${doc.id}')" class="btn btn-secondary btn-sm"><i class="fas fa-edit"></i> แก้ไข</button>
                        <button onclick="deleteMenu('${doc.id}')" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i> ลบ</button>
                    </div>
                </div>
            `;
            menuList.appendChild(card);
        });
    });
}

window.editMenu = (menuId) => {
    const menu = currentOrders.find(m => m.id === menuId); // Note: In real app, keep a separate menu state
    // ในที่นี้สมมติว่าดึงจาก Database โดยตรงเพื่อความง่าย
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
    try {
        await deleteDoc(doc(db, "menus", menuId));
        showToast("ลบเมนูสำเร็จ", "success");
    } catch (error) {
        showToast("ลบไม่สำเร็จ: " + error.message, "error");
    }
};

// ==========================================
// 11. Store Settings
// ==========================================
async function loadStoreSettings() {
    try {
        const docSnap = await getDoc(doc(db, "merchants", currentMerchantId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            document.getElementById('shopNameInput').value = data.shopName || '';
            document.getElementById('shopAddressInput').value = data.address || '';
            document.getElementById('shopPhoneInput').value = data.phone || '';
            document.getElementById('openTimeInput').value = data.openTime || '08:00';
            document.getElementById('closeTimeInput').value = data.closeTime || '20:00';
            
            const isOpen = data.isOpen !== false;
            document.getElementById('storeStatusToggle').checked = isOpen;
            updateStoreStatusUI(isOpen);
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

function updateStoreStatusUI(isOpen) {
    const statusText = document.getElementById('storeStatusText');
    if (isOpen) {
        statusText.innerHTML = '<i class="fas fa-circle"></i> เปิดร้าน';
        statusText.className = 'status-open';
    } else {
        statusText.innerHTML = '<i class="fas fa-circle"></i> ปิดร้าน';
        statusText.className = 'status-closed';
    }
}

// ==========================================
// 12. Event Listeners
// ==========================================
function setupEventListeners() {
    // Save Settings
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        try {
            await setDoc(doc(db, "merchants", currentMerchantId), {
                shopName: document.getElementById('shopNameInput').value,
                address: document.getElementById('shopAddressInput').value,
                phone: document.getElementById('shopPhoneInput').value,
                openTime: document.getElementById('openTimeInput').value,
                closeTime: document.getElementById('closeTimeInput').value,
                ownerId: currentMerchantId
            }, { merge: true });
            showToast("บันทึกการตั้งค่าสำเร็จ", "success");
        } catch (error) {
            showToast("บันทึกไม่สำเร็จ: " + error.message, "error");
        }
    });

    // Toggle Store Status
    document.getElementById('storeStatusToggle').addEventListener('change', async (e) => {
        const isOpen = e.target.checked;
        updateStoreStatusUI(isOpen);
        try {
            await updateDoc(doc(db, "merchants", currentMerchantId), { isOpen });
            showToast(isOpen ? "เปิดร้านแล้ว" : "ปิดร้านแล้ว", "success");
        } catch (error) {
            console.error("Error updating store status:", error);
        }
    });

    // Add Menu Button
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

    // Save Menu (Add or Edit)
    document.getElementById('saveMenuBtn').addEventListener('click', async () => {
        const menuId = document.getElementById('menuIdInput').value;
        const name = document.getElementById('menuNameInput').value;
        const price = parseFloat(document.getElementById('menuPriceInput').value);
        const category = document.getElementById('menuCategoryInput').value;

        if (!name || !price || price <= 0) {
            showToast("กรุณากรอกชื่อเมนูและราคาให้ถูกต้อง", "warning");
            return;
        }

        const menuData = {
            merchantId: currentMerchantId,
            name, price, category,
            description: document.getElementById('menuDescInput').value,
            imageUrl: document.getElementById('menuImageInput').value,
            updatedAt: serverTimestamp()
        };

        try {
            if (menuId) {
                // Edit mode
                await updateDoc(doc(db, "menus", menuId), menuData);
                showToast("แก้ไขเมนูสำเร็จ", "success");
            } else {
                // Add mode
                menuData.createdAt = serverTimestamp();
                await addDoc(collection(db, "menus"), menuData);
                showToast("เพิ่มเมนูสำเร็จ", "success");
            }
            closeModal('menuModal');
        } catch (error) {
            showToast("บันทึกไม่สำเร็จ: " + error.message, "error");
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (unsubscribeOrders) unsubscribeOrders();
        if (unsubscribeMenus) unsubscribeMenus();
        signOut(auth).then(() => window.location.href = 'index.html');
    });
}