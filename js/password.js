// 密码保护功能（Taliabu WebTV：PASSWORD 可选）

/**
 * 检查是否设置了密码保护。
 * 未设置 PASSWORD 时直接开放访问；设置后仍保留原有密码保护能力。
 */
function isPasswordProtected() {
    const pwd = window.__ENV__ && window.__ENV__.PASSWORD;
    return typeof pwd === 'string' && pwd.length === 64 && !/^0+$/.test(pwd);
}

/**
 * 不再强制要求部署时必须配置 PASSWORD。
 */
function isPasswordRequired() {
    return false;
}

/**
 * 关键操作前的密码保护检查。
 * 只有真正配置了 PASSWORD 时才要求验证。
 */
function ensurePasswordProtection() {
    if (isPasswordProtected() && !isPasswordVerified()) {
        showPasswordModal();
        throw new Error('Password verification required');
    }
    return true;
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;

/**
 * 验证用户输入的密码是否正确（异步，使用 SHA-256 哈希）
 */
async function verifyPassword(password) {
    try {
        const correctHash = window.__ENV__?.PASSWORD;
        if (!correctHash) return false;

        const inputHash = await sha256(password);
        const isValid = inputHash === correctHash;

        if (isValid) {
            localStorage.setItem(PASSWORD_CONFIG.localStorageKey, JSON.stringify({
                verified: true,
                timestamp: Date.now(),
                passwordHash: correctHash
            }));
        }
        return isValid;
    } catch (error) {
        console.error('验证密码时出错:', error);
        return false;
    }
}

// 验证状态检查
function isPasswordVerified() {
    try {
        // 未配置 PASSWORD 时始终视为已验证
        if (!isPasswordProtected()) return true;

        const stored = localStorage.getItem(PASSWORD_CONFIG.localStorageKey);
        if (!stored) return false;

        const { timestamp, passwordHash } = JSON.parse(stored);
        const currentHash = window.__ENV__?.PASSWORD;

        return timestamp && passwordHash === currentHash &&
            Date.now() - timestamp < PASSWORD_CONFIG.verificationTTL;
    } catch (error) {
        console.error('检查密码验证状态时出错:', error);
        return false;
    }
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;
window.isPasswordVerified = isPasswordVerified;
window.verifyPassword = verifyPassword;
window.ensurePasswordProtection = ensurePasswordProtection;

// SHA-256 实现
async function sha256(message) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof window._jsSha256 === 'function') {
        return window._jsSha256(message);
    }
    throw new Error('No SHA-256 implementation available.');
}

/** 显示密码验证弹窗 */
function showPasswordModal() {
    // 没有配置 PASSWORD 时绝不弹窗
    if (!isPasswordProtected()) return;

    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        const doubanArea = document.getElementById('doubanArea');
        if (doubanArea) doubanArea.classList.add('hidden');

        const cancelBtn = document.getElementById('passwordCancelBtn');
        if (cancelBtn) cancelBtn.classList.add('hidden');

        const title = passwordModal.querySelector('h2');
        const description = passwordModal.querySelector('p');
        if (title) title.textContent = '访问验证';
        if (description) description.textContent = '请输入密码继续访问';

        const form = passwordModal.querySelector('form');
        if (form) form.style.display = 'block';

        const errorMsg = document.getElementById('passwordError');
        if (errorMsg) {
            errorMsg.textContent = '密码错误，请重试';
            errorMsg.className = 'text-red-500 mt-2 hidden';
        }

        passwordModal.style.display = 'flex';
        setTimeout(() => {
            const passwordInput = document.getElementById('passwordInput');
            if (passwordInput) passwordInput.focus();
        }, 100);
    }
}

/** 隐藏密码验证弹窗 */
function hidePasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        hidePasswordError();

        const passwordInput = document.getElementById('passwordInput');
        if (passwordInput) passwordInput.value = '';

        passwordModal.style.display = 'none';

        if (localStorage.getItem('doubanEnabled') === 'true') {
            const doubanArea = document.getElementById('doubanArea');
            if (doubanArea) doubanArea.classList.remove('hidden');
            if (typeof initDouban === 'function') initDouban();
        }
    }
}

function showPasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) errorElement.classList.remove('hidden');
}

function hidePasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) errorElement.classList.add('hidden');
}

async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('passwordInput');
    const password = passwordInput ? passwordInput.value.trim() : '';
    if (await verifyPassword(password)) {
        hidePasswordModal();
        document.dispatchEvent(new CustomEvent('passwordVerified'));
    } else {
        showPasswordError();
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
    }
}

/**
 * 初始化：未设置 PASSWORD 时什么都不做；设置了才弹验证框。
 */
function initPasswordProtection() {
    if (isPasswordProtected() && !isPasswordVerified()) {
        showPasswordModal();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    initPasswordProtection();
});
