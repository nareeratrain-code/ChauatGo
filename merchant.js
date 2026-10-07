// ==========================================
// 4. ระบบตรวจสอบสิทธิ์ (Auth Guard) - เวอร์ชัน Debug
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("🔑 ล็อกอินด้วย UID:", user.uid);
        console.log("📧 อีเมล:", user.email);
        
        try {
            // ดึงข้อมูล Role จาก Collection users
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                console.error("❌ ไม่พบ Document ใน Collection 'users' สำหรับ UID นี้");
                throw new Error("ไม่พบข้อมูลผู้ใช้ในระบบ (users collection)");
            }

            const userData = userDocSnap.data();
            console.log("📄 ข้อมูลที่ดึงมาได้:", userData);

            // ตรวจสอบ Role
            if (userData.role === 'merchant') {
                console.log("✅ ผ่าน! คุณเป็น Merchant");
                currentMerchantId = user.uid;
                document.getElementById('merchantName').innerText = userData.name || "ร้านค้า";
                
                // ซ่อนหน้า Loading และ Error, แสดง Dashboard
                document.getElementById('loadingScreen').classList.remove('active');
                document.getElementById('errorScreen').classList.remove('active'); // เพิ่มบรรทัดนี้
                document.getElementById('dashboardScreen').classList.add('active');
                
                loadOrders();
                loadStoreSettings();
                loadMenus();
                setupNavigation();
                setupEventListeners();
            } else {
                console.warn("⛔ Role ไม่ใช่ merchant แต่เป็น:", userData.role);
                showError(`บัญชีนี้ไม่มีสิทธิ์เข้าใช้งาน (Role ของคุณคือ: ${userData.role || 'ไม่มีข้อมูล'})`);
            }

        } catch (error) {
            console.error("❌ เกิดข้อผิดพลาด:", error);
            showError("เกิดข้อผิดพลาด: " + error.message);
        }
    } else {
        console.log("⛔ ยังไม่ได้ล็อกอิน");
        window.location.href = 'index.html';
    }
});