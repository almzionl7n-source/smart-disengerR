/**
 * SMART DESIGNER PRO - CORE ENGINE v6.0
 * المبرمج المساعد: Gemini
 * المالك: سعود
 */

// 1. إعدادات المحرك الأساسية (Canvas Setup)
const canvas = new fabric.Canvas('main-canvas', {
    width: 900,
    height: 600,
    backgroundColor: '#ffffff',
    preserveObjectStacking: true,
    stopContextMenu: true
});

// إعدادات المقابض والتحكم بستايل "Marble White"
fabric.Object.prototype.set({
    cornerColor: '#ffffff',
    cornerStyle: 'circle',
    borderColor: '#ffffff',
    cornerSize: 12,
    transparentCorners: false,
    borderScaleFactor: 2.5,
    padding: 10,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 20 })
});

// 2. إدارة الواجهة والتبديل بين الألواح (UI Switching)
document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => {
        const target = button.getAttribute('data-target');
        
        // تحديث الأزرار
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        // تحديث الألواح
        document.querySelectorAll('.panel-content').forEach(panel => panel.classList.add('hidden'));
        document.getElementById(target).classList.remove('hidden');
    });
});

// 3. محرك إضافة العناصر (The Builder)
function addShape(type) {
    let shape;
    const common = { left: 200, top: 150, fill: '#1a1a1a', width: 150, height: 150 };
    
    switch(type) {
        case 'rect': shape = new fabric.Rect({...common, rx: 15, ry: 15}); break;
        case 'circle': shape = new fabric.Circle({...common, radius: 75}); break;
        case 'triangle': shape = new fabric.Triangle(common); break;
        case 'star': 
            shape = new fabric.Path('M 50 0 L 61 35 L 98 35 L 68 57 L 79 91 L 50 70 L 21 91 L 32 57 L 2 35 L 39 35 Z', {
                ...common, scaleX: 2, scaleY: 2
            });
            break;
    }
    canvas.add(shape);
    canvas.setActiveObject(shape);
    updateStats();
}

// 4. محرك الذكاء الاصطناعي (AI Generation Engine)
const aiBtn = document.getElementById('generate-btn');
aiBtn.addEventListener('click', async () => {
    const prompt = document.getElementById('ai-prompt').value;
    if(!prompt) return swal("عفواً يا سعود!", "اكتب وصفاً ليقوم المحرك بالعمل", "warning");

    aiBtn.classList.add('loading-pulse');
    aiBtn.innerHTML = '<span>جاري تحليل البيانات...</span>';

    // استخدام محرك Unsplash API كواجهة برمجية لجلب صور بناءً على الوصف
    const url = `https://source.unsplash.com/featured/1600x900/?${encodeURIComponent(prompt)}&sig=${Math.random()}`;
    
    fabric.Image.fromURL(url, (img) => {
        img.scaleToWidth(500);
        img.set({ left: 50, top: 50 });
        canvas.add(img);
        canvas.setActiveObject(img);
        
        aiBtn.classList.remove('loading-pulse');
        aiBtn.innerHTML = '<span>توليد صورة ذكية</span> <i class="fas fa-sparkles"></i>';
        
        swal("تم التوليد!", "الصورة الآن جاهزة في منطقة العمل", "success");
        updateStats();
    }, { crossOrigin: 'anonymous' });
});

// 5. محرك الرسم الحر (The Brush Engine)
let isDrawing = false;
function toggleDrawingMode() {
    isDrawing = !isDrawing;
    canvas.isDrawingMode = isDrawing;
    
    const btn = document.querySelector('[onclick="toggleDrawingMode()"]');
    if(isDrawing) {
        btn.innerHTML = "إيقاف وضع الرسم";
        btn.classList.add('bg-red-600');
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.width = parseInt(document.getElementById('brush-size').value);
        canvas.freeDrawingBrush.color = '#ffffff';
    } else {
        btn.innerHTML = "تفعيل وضع الرسم";
        btn.classList.remove('bg-red-600');
    }
}

// 6. محرك الخصائص والطبقات (Selection & Properties)
canvas.on('selection:created', showProperties);
canvas.on('selection:updated', showProperties);
canvas.on('selection:cleared', hideProperties);

function showProperties() {
    const obj = canvas.getActiveObject();
    const editor = document.getElementById('property-editor');
    editor.innerHTML = `
        <div class="animate__animated animate__fadeIn">
            <h4 class="text-[10px] font-black uppercase text-gray-500 mb-4 tracking-widest">تعديل العنصر</h4>
            <div class="mb-4">
                <label class="text-[9px] block mb-2 uppercase">اللون الفعلي</label>
                <input type="color" id="fill-color" value="${obj.fill}" class="w-full h-10 bg-transparent cursor-pointer">
            </div>
            <div class="mb-6">
                <label class="text-[9px] block mb-2 uppercase">الشفافية</label>
                <input type="range" id="op-slider" min="0" max="1" step="0.01" value="${obj.opacity}" class="w-full">
            </div>
            <div class="grid grid-cols-2 gap-2">
                <button onclick="changeZ('front')" class="bg-white/5 p-2 rounded text-[10px] hover:bg-white hover:text-black transition">للأمام</button>
                <button onclick="changeZ('back')" class="bg-white/5 p-2 rounded text-[10px] hover:bg-white hover:text-black transition">للخلف</button>
            </div>
            <button onclick="deleteSelected()" class="w-full mt-4 bg-red-600/20 text-red-500 p-2 rounded text-[10px] font-bold">حذف العنصر</button>
        </div>
    `;
    
    // ربط الأحداث بمحرك التعديل
    document.getElementById('fill-color').oninput = (e) => {
        obj.set('fill', e.target.value);
        canvas.renderAll();
    };
    document.getElementById('op-slider').oninput = (e) => {
        obj.set('opacity', parseFloat(e.target.value));
        canvas.renderAll();
    };
}

function hideProperties() {
    document.getElementById('property-editor').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-mouse-pointer"></i>
            <p>حدد عنصراً لتعديله</p>
        </div>
    `;
}

// 7. محرك الحذف والتحكم (Utilities)
function deleteSelected() {
    canvas.remove(canvas.getActiveObject());
    canvas.discardActiveObject();
    updateStats();
}

function changeZ(type) {
    const obj = canvas.getActiveObject();
    if(type === 'front') obj.bringToFront();
    else obj.sendToBack();
    canvas.renderAll();
}

function updateStats() {
    document.getElementById('obj-count').innerText = canvas.getObjects().length;
}

// 8. محرك التصدير والحفظ (Export System)
function openExportModal() {
    document.getElementById('export-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('export-modal').classList.add('hidden');
}

function doExport(format) {
    canvas.discardActiveObject();
    canvas.renderAll();
    
    let dataURL;
    if(format === 'png') {
        dataURL = canvas.toDataURL({ format: 'png', multiplier: 2 });
    } else {
        dataURL = canvas.toDataURL({ format: 'jpeg', quality: 0.9, multiplier: 2 });
    }

    const link = document.createElement('a');
    link.download = `SmartDesigner_Project_${Date.now()}.${format}`;
    link.href = dataURL;
    link.click();
    closeModal();
    swal("تم التصدير!", "تم حفظ الملف بجودة عالية", "success");
}

// 9. اختصارات الكيبورد (Keyboard Shortcuts)
window.addEventListener('keydown', (e) => {
    if(e.key === 'Delete') deleteSelected();
    if(e.ctrlKey && e.key === 'z') undo();
});

// 10. محرك التكبير والتصغير (Zoom Engine)
let currentZoom = 1;
function changeZoom(delta) {
    currentZoom += delta;
    if(currentZoom < 0.1) currentZoom = 0.1;
    if(currentZoom > 3) currentZoom = 3;
    canvas.setZoom(currentZoom);
    document.getElementById('zoom-val').innerText = Math.round(currentZoom * 100) + '%';
}

// تشغيل نظام التحميل التلقائي (Auto-Save)
setInterval(() => {
    const json = canvas.toJSON();
    localStorage.setItem('smart_designer_pro_save', JSON.stringify(json));
    // تحريك شريط الحالة العلوي كإشارة للحفظ
    const bar = document.getElementById('status-bar');
    bar.style.width = '100%';
    setTimeout(() => bar.style.width = '0', 800);
}, 15000);

// استعادة آخر مشروع عند الفتح
window.onload = () => {
    const saved = localStorage.getItem('smart_designer_pro_save');
    if(saved) {
        canvas.loadFromJSON(JSON.parse(saved), canvas.renderAll.bind(canvas));
    }
};
