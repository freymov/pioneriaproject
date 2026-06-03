// public/js/calculator-ui.js
const CalculatorUI = {
    // Состояние калькулятора
    state: {
        operand1: null,
        operand2: null,
        alt1: 0,
        alt2: 0,
        direction: 1,
        mode: 'interval' // 'interval' | 'chord' | 'note'
    },
    
    init() {
        this.renderCalculator();
        this.attachEvents();
    },
    
    renderCalculator() {
        const container = document.getElementById('calculator');
        
        container.innerHTML = `
            <div class="music-calc-container">
                <!-- Дисплей -->
                <div class="calc-display" id="calcDisplay">
                    <span id="operand1">Выберите ноту</span>
                    <span id="direction"></span>
                    <span id="operand2"></span>
                    <span id="result"></span>
                </div>
                
                <!-- Режимы -->
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 16px;">
                    <button class="calc-btn chord-btn mode-btn active" data-mode="interval">🎵 Интервалы</button>
                    <button class="calc-btn chord-btn mode-btn" data-mode="chord">🎸 Аккорды</button>
                    <button class="calc-btn mod-btn mode-btn" data-mode="note">🎼 От ноты</button>
                    <button class="calc-btn mod-btn mode-btn" data-mode="tonality">🎹 Тон-ти</button>
                </div>
                
                <!-- Ноты -->
                <div class="calc-grid" id="noteButtons">
                    ${MusicCalc.notes.slice(0, 7).map((note, i) => `
                        <button class="calc-btn note-btn" data-note="${note}" data-stup="${i + 1}" data-rel="${MusicCalc.polutonov[i]}">
                            <strong>${['C','D','E','F','G','A','H'][i]}</strong><br>${note}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Модификаторы -->
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;">
                    <button class="calc-btn mod-btn" data-alt="-1">♭ Бемоль</button>
                    <button class="calc-btn mod-btn" data-alt="1">♯ Диез</button>
                    <button class="calc-btn mod-btn" data-alt="0">♮ Бекар</button>
                </div>
                
                <!-- Направление -->
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;">
                    <button class="calc-btn interval-btn" data-dir="1">↑ Вверх</button>
                    <button class="calc-btn interval-btn" data-dir="-1">↓ Вниз</button>
                </div>
                
                <!-- Интервалы -->
                <div class="calc-grid" style="grid-template-columns: repeat(5, 1fr); margin-top: 8px;" id="intervalButtons">
                    ${['Прима','Секунда','Терция','Кварта','Квинта','Секста','Септима','Октава'].map((name, i) => `
                        <button class="calc-btn interval-btn" data-interval="${i + 1}" data-sem="${MusicCalc.polutonov[i]}">
                            ${i + 1}<br>${name}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Очистка -->
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn clear-btn" id="clearBtn">CLEAR</button>
                </div>
                
                <!-- Нотный стан -->
                <div class="note-staff" id="noteStaff">
                    <div class="staff-lines">=====================</div>
                    <div class="note-symbol" id="note1" style="left: 120px;">w</div>
                    <div class="note-symbol" id="note2" style="left: 220px;">w</div>
                </div>
            </div>
        `;
    },
    
    attachEvents() {
        // Здесь будет логика обработки кликов
        document.getElementById('calculator').addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            
            // Обработка разных типов кнопок
            if (btn.dataset.note) {
                this.handleNoteClick(btn);
            } else if (btn.dataset.alt !== undefined) {
                this.handleAltClick(btn);
            } else if (btn.dataset.dir) {
                this.handleDirectionClick(btn);
            } else if (btn.dataset.interval) {
                this.handleIntervalClick(btn);
            } else if (btn.id === 'clearBtn') {
                this.clear();
            } else if (btn.dataset.mode) {
                this.setMode(btn.dataset.mode);
            }
        });
    },
    
    handleNoteClick(btn) {
        const note = btn.dataset.note;
        const stup = parseInt(btn.dataset.stup);
        const rel = parseInt(btn.dataset.rel);
        
        if (!this.state.operand1) {
            this.state.operand1 = { note, stup, rel };
            document.getElementById('operand1').textContent = note;
            this.showNoteOnStaff('note1', stup);
        } else if (!this.state.operand2) {
            this.state.operand2 = { note, stup, rel };
            document.getElementById('operand2').textContent = note;
            this.showNoteOnStaff('note2', stup);
            this.calculateResult();
        }
    },
    
    calculateResult() {
        const result = MusicCalc.getInterval(
            this.state.operand1.stup,
            this.state.alt1,
            this.state.operand2.stup,
            this.state.alt2
        );
        
        document.getElementById('result').textContent = `= ${result.type} ${result.name}`;
    },
    
    showNoteOnStaff(noteId, step) {
        const noteEl = document.getElementById(noteId);
        if (noteEl) {
            noteEl.style.display = 'block';
            noteEl.style.top = `${16 - step * 5.3}px`;
        }
    },
    
    clear() {
        this.state.operand1 = null;
        this.state.operand2 = null;
        this.state.alt1 = 0;
        this.state.alt2 = 0;
        
        document.getElementById('operand1').textContent = 'Выберите ноту';
        document.getElementById('operand2').textContent = '';
        document.getElementById('result').textContent = '';
        
        document.getElementById('note1').style.display = 'none';
        document.getElementById('note2').style.display = 'none';
    }
};
