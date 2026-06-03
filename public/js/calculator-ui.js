// public/js/calculator-ui.js
console.log('✅ calculator-ui.js загружен');

const CalculatorUI = {
    state: {
        operand1: null,
        operand2: null,
        alt1: 0,
        alt2: 0,
        direction: 1,
        mode: 'interval'
    },
    
    init() {
        console.log('🚀 CalculatorUI.init() запущен');
        this.renderCalculator();
        this.attachEvents();
        console.log('✅ Калькулятор отрисован');
    },
    
    renderCalculator() {
        const container = document.getElementById('calculator');
        if (!container) {
            console.error('❌ Контейнер #calculator не найден!');
            return;
        }
        
        container.innerHTML = `
            <div class="music-calc-container">
                <div class="calc-display" id="calcDisplay">
                    <span id="operand1">Выберите ноту</span>
                    <span id="direction"></span>
                    <span id="operand2"></span>
                    <span id="result"></span>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 16px;">
                    <button class="calc-btn chord-btn mode-btn active" data-mode="interval">🎵 Интервалы</button>
                    <button class="calc-btn chord-btn mode-btn" data-mode="chord">🎸 Аккорды</button>
                    <button class="calc-btn mod-btn mode-btn" data-mode="note">🎼 От ноты</button>
                    <button class="calc-btn mod-btn mode-btn" data-mode="tonality">🎹 Тон-ти</button>
                </div>
                
                <div class="calc-grid" id="noteButtons">
                    ${MusicCalc.notes.slice(0, 7).map((note, i) => `
                        <button class="calc-btn note-btn" data-note="${note}" data-stup="${i + 1}" data-rel="${MusicCalc.polutonov[i]}">
                            <strong>${['C','D','E','F','G','A','H'][i]}</strong><br>${note}
                        </button>
                    `).join('')}
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;">
                    <button class="calc-btn mod-btn" data-alt="-1">♭ Бемоль</button>
                    <button class="calc-btn mod-btn" data-alt="1">♯ Диез</button>
                    <button class="calc-btn mod-btn" data-alt="0">♮ Бекар</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;">
                    <button class="calc-btn interval-btn" data-dir="1">↑ Вверх</button>
                    <button class="calc-btn interval-btn" data-dir="-1">↓ Вниз</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;" id="intervalButtons">
                    ${['Прима','Секунда','Терция','Кварта','Квинта','Секста','Септима','Октава'].map((name, i) => `
                        <button class="calc-btn interval-btn" data-interval="${i + 1}" data-sem="${MusicCalc.polutonov[i]}">
                            ${i + 1}<br>${name}
                        </button>
                    `).join('')}
                </div>
                
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn clear-btn" id="clearBtn">ОЧИСТИТЬ</button>
                </div>
                
                <div class="note-staff" id="noteStaff">
                    <div class="staff-lines" style="font-family: Petrucci;">=====================</div>
                    <div class="note-symbol" id="note1" style="left: 120px; font-family: Petrucci;">w</div>
                    <div class="note-symbol" id="note2" style="left: 220px; font-family: Petrucci;">w</div>
                </div>
            </div>
        `;
    },
    
    attachEvents() {
        const calc = document.getElementById('calculator');
        if (!calc) return;
        
        calc.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            
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
        console.log('🎵 Нажата нота:', btn.dataset.note);
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
    
    handleAltClick(btn) {
        console.log('🎵 Альтерация:', btn.dataset.alt);
        const alt = parseInt(btn.dataset.alt);
        
        if (this.state.operand2) {
            this.state.alt2 = alt;
        } else if (this.state.operand1) {
            this.state.alt1 = alt;
        }
    },
    
    handleDirectionClick(btn) {
        console.log('🎵 Направление:', btn.dataset.dir);
        this.state.direction = parseInt(btn.dataset.dir);
        document.getElementById('direction').textContent = btn.dataset.dir === '1' ? '↑' : '↓';
    },
    
    handleIntervalClick(btn) {
        console.log('🎵 Интервал:', btn.dataset.interval);
        // Заглушка для будущей функциональности
    },
    
    setMode(mode) {
        console.log('🎵 Режим:', mode);
        this.state.mode = mode;
        
        // Обновляем активную кнопку
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
        
        this.clear();
    },
    
    calculateResult() {
        if (!this.state.operand1 || !this.state.operand2) return;
        
        const result = MusicCalc.getInterval(
            this.state.operand1.stup,
            this.state.alt1,
            this.state.operand2.stup,
            this.state.alt2
        );
        
        document.getElementById('result').textContent = `= ${result.type} ${result.name}`;
        console.log('✅ Результат:', result);
    },
    
    showNoteOnStaff(noteId, step) {
        const noteEl = document.getElementById(noteId);
        if (noteEl) {
            noteEl.style.display = 'block';
            noteEl.style.top = `${16 - step * 5.3}px`;
        }
    },
    
    clear() {
        console.log('🧹 Очистка');
        this.state.operand1 = null;
        this.state.operand2 = null;
        this.state.alt1 = 0;
        this.state.alt2 = 0;
        
        const op1 = document.getElementById('operand1');
        const op2 = document.getElementById('operand2');
        const res = document.getElementById('result');
        const dir = document.getElementById('direction');
        const n1 = document.getElementById('note1');
        const n2 = document.getElementById('note2');
        
        if (op1) op1.textContent = 'Выберите ноту';
        if (op2) op2.textContent = '';
        if (res) res.textContent = '';
        if (dir) dir.textContent = '';
        if (n1) n1.style.display = 'none';
        if (n2) n2.style.display = 'none';
    }
};
