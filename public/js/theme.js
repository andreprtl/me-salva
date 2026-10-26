// Aplica o tema salvo antes de desenhar a página (claro por padrão).
try { if (localStorage.getItem('ms-theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) { /* sem armazenamento */ }
