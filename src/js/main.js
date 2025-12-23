import { NoelApp } from './NoelApp.js';

// Khởi tạo ứng dựng khi DOM đã sẵn sàng
window.addEventListener('DOMContentLoaded', () => {
    console.log("Christmas Magic Initializing...");
    window.app = new NoelApp();
});
