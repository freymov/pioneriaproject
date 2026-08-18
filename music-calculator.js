/* public/css/calculator.css */

/* ===== ОСНОВНЫЕ ПЕРЕМЕННЫЕ ===== */
:root, [data-theme="light"] {
    --calc-bg: #ffffff;
    --calc-text: #1a1a2e;
    --calc-border: #e0e3eb;
    --calc-display-bg: #f8f9fb;
    --calc-shadow: 0 2px 8px rgba(0,0,0,0.08);
    
    /* Кнопки нот */
    --note-btn-bg: #fff9c4;
    --note-btn-border: #f9a825;
    --note-btn-text: #333;
    --note-btn-hover: #fff176;
    
    /* Кнопки альтерации */
    --alt-btn-bg: #424242;
    --alt-btn-text: #fff;
    --alt-btn-hover: #616161;
    
    /* Кнопки интервалов */
    --interval-btn-bg: #e8eaf6;
    --interval-btn-border: #5c6bc0;
    --interval-btn-text: #1a237e;
    --interval-btn-hover: #c5cae9;
    
    /* Кнопки лада */
    --chord-btn-bg: #c8e6c9;
    --chord-btn-border: #66bb6a;
    --chord-btn-text: #1b5e20;
    --chord-btn-hover: #a5d6a7;
    
    /* Нотный стан */
    --staff-bg: #fffef5;
    --staff-lines: #333;
}

[data-theme="dark"] {
    --calc-bg: #1e1e32;
    --calc-text: #e4e6eb;
    --calc-border: #2a2a40;
    --calc-display-bg: #252540;
    --calc-shadow: 0 2px 8px rgba(0,0,0,0.3);
    
    --note-btn-bg: #3e3520;
    --note-btn-border: #f9a825;
    --note-btn-text: #ffe082;
    --note-btn-hover: #4a4028;
    
    --alt-btn-bg: #616161;
    --alt-btn-text: #fff;
    --alt-btn-hover: #757575;
    
    --interval-btn-bg: #1a1a3e;
    --interval-btn-border: #5c6bc0;
    --interval-btn-text: #c5cae9;
    --interval-btn-hover: #252550;
    
    --chord-btn-bg: #1a3a1a;
    --chord-btn-border: #66bb6a;
    --chord-btn-text: #a5d6a7;
    --chord-btn-hover: #254425;
    
    --staff-bg: #252535;
    --staff-lines: #ccc;
}

/* ===== КОНТЕЙНЕР ===== */
.music-calc-container {
    background: var(--calc-bg);
    border-radius: 16px;
    padding: 20px;
    box-shadow: var(--calc-shadow);
    color: var(--calc-text);
    max-width: 900px;
    margin: 0 auto;
}

/* ===== ДИСПЛЕЙ ===== */
.calc-display {
    background: var(--calc-display-bg);
    border: 1px solid var(--calc-border);
    border-radius: 10px;
    padding: 14px 18px;
    margin-bottom: 20px;
    font-size: 16px;
    min-height: 50px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-weight: 500;
}

.calc-display span {
    white-space: nowrap;
}

/* ===== СЕТКА КНОПОК ===== */
.calc-grid {
    display: grid;
    gap: 8px;
    margin-bottom: 8px;
}

.calc-btn {
    padding: 12px 6px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
    border: 1px solid transparent;
    text-align: center;
    line-height: 1.3;
}

.calc-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}

.calc-btn:active {
    transform: scale(0.96);
}

/* Кнопки нот */
.note-btn {
    background: var(--note-btn-bg);
    border-color: var(--note-btn-border);
    color: var(--note-btn-text);
}
.note-btn:hover { background: var(--note-btn-hover); }

/* Кнопки альтерации */
.alt-btn {
    background: var(--alt-btn-bg);
    color: var(--alt-btn-text);
    border-color: transparent;
}
.alt-btn:hover { background: var(--alt-btn-hover); }

/* Кнопки интервалов */
.interval-btn {
    background: var(--interval-btn-bg);
    border-color: var(--interval-btn-border);
    color: var(--interval-btn-text);
}
.interval-btn:hover { background: var(--interval-btn-hover); }

/* Кнопки лада/аккордов */
.chord-btn {
    background: var(--chord-btn-bg);
    border-color: var(--chord-btn-border);
    color: var(--chord-btn-text);
}
.chord-btn:hover { background: var(--chord-btn-hover); }

/* Кнопка очистки */
.clear-btn {
    background: #ef5350;
    color: white;
    border-color: #c62828;
    grid-column: 1 / -1;
    font-weight: 700;
    font-size: 15px;
}
.clear-btn:hover { background: #e53935; }

/* Режимы */
.mode-btn.active {
    box-shadow: 0 0 0 2px var(--calc-text);
    font-weight: 700;
}

/* ===== НОТНЫЙ СТАН ===== */
.note-staff {
    margin-top: 24px;
    background: var(--staff-bg);
    border-radius: 8px;
    padding: 10px 0;
    position: relative;
    min-height: 130px;
    overflow-x: auto;
}

.staff-wrapper {
    position: relative;
    font-family: 'Petrucci', serif;
    min-width: 600px;
    height: 110px;
    font-size: 22px;
    color: var(--staff-lines);
}

/* Скрипичный ключ */
.staff-clef {
    position: absolute;
    left: 5px;
    top: 8px;
    font-size: 38px;
    z-index: 2;
}

/* 5 линий стана */
.staff-lines {
    position: absolute;
    left: 45px;
    top: 8px;
    letter-spacing: 3px;
    font-size: 22px;
    z-index: 1;
}

/* Ноты на стане */
.note-on-staff {
    position: absolute;
    font-size: 28px;
    z-index: 3;
    display: none;
}

/* Знаки альтерации на стане */
.sign-on-staff {
    position: absolute;
    font-size: 16px;
    z-index: 4;
    display: none;
}

/* Адаптивность */
@media (max-width: 768px) {
    .calc-btn {
        padding: 10px 4px;
        font-size: 11px;
    }
    .calc-display {
        font-size: 14px;
        padding: 10px 12px;
    }
    .staff-wrapper {
        min-width: 400px;
        font-size: 18px;
    }
    .staff-clef {
        font-size: 30px;
    }
}
