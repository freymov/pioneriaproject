// public/js/calculator-ui.js
console.log('✅ calculator-ui.js загружен');

const CalculatorUI = {
    state: {
        operand1: null,
        operand2: null,
        operand3: null,
        operand4: null,
        operand5: null,
        stupen1: null,
        stupen2: null,
        stupen3: null,
        stupen4: null,
        stupen5: null,
        alt1: 0,
        alt2: 0,
        alt3: 0,
        alt4: 0,
        alt5: 0,
        alt_int: 0,
        direction: 1,
        mode: 'interval', // 'interval' | 'chord' | 'note' | 'tonality'
        lad: '',
        tone_nota: null,
        tone_alt: 0,
        tone_lad: ''
    },
    
    init() {
        console.log('🚀 CalculatorUI.init() запущен');
        this.renderCalculator();
        this.attachEvents();
        this.updateButtonStates();
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
                <!-- Дисплей -->
                <div class="calc-display" id="calcDisplay">
                    <span id="operand1">Выберите ноту</span>
                    <span id="alt1"></span>
                    <span id="direction"></span>
                    <span id="alt_int"></span>
                    <span id="operand2"></span>
                    <span id="alt2"></span>
                    <span id="operand3"></span>
                    <span id="alt3"></span>
                    <span id="equal" style="display:none;">=</span>
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
                
                <!-- Альтерация -->
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;" id="altButtons">
                    <button class="calc-btn mod-btn" data-alt="-1">♭ Бемоль</button>
                    <button class="calc-btn mod-btn" data-alt="1">♯ Диез</button>
                    <button class="calc-btn mod-btn" data-alt="0">♮ Бекар</button>
                </div>
                
                <!-- Лад -->
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;" id="ladButtons">
                    <button class="calc-btn chord-btn" data-lad="Мажор" style="background:#ff6000;">Dur<br>Мажор</button>
                    <button class="calc-btn chord-btn" data-lad="Минор" style="background:#006a76;">moll<br>Минор</button>
                </div>
                
                <!-- Направление -->
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;" id="dirButtons">
                    <button class="calc-btn interval-btn" data-dir="1">↑ Вверх</button>
                    <button class="calc-btn interval-btn" data-dir="-1">↓ Вниз</button>
                </div>
                
                <!-- Интервалы -->
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;" id="intervalButtons">
                    ${['Прима','Секунда','Терция','Кварта','Квинта','Секста','Септима','Октава','Нона','Децима'].map((name, i) => `
                        <button class="calc-btn interval-btn" data-interval="${i + 1}" data-sem="${MusicCalc.polutonov[i]}">
                            ${i + 1}<br>${name}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Типы интервалов -->
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;" id="intervalTypes">
                    <button class="calc-btn mod-btn" data-type="small">М<br>Малая</button>
                    <button class="calc-btn mod-btn" data-type="big">Б<br>Большая</button>
                    <button class="calc-btn mod-btn" data-type="clean">Ч<br>Чистая</button>
                    <button class="calc-btn mod-btn" data-type="aug">Ув<br>Увел.</button>
                </div>
                
                <!-- Функции аккордов -->
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;" id="funcButtons">
                    <button class="calc-btn mod-btn" data-func="t">T<br>Тоника</button>
                    <button class="calc-btn mod-btn" data-func="s">S<br>Субдом.</button>
                    <button class="calc-btn mod-btn" data-func="d">D<br>Домин.</button>
                </div>
                
                <!-- Очистка -->
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn clear-btn" id="clearBtn">ОЧИСТИТЬ</button>
                </div>
                
                <!-- Кнопка "равно" -->
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn chord-btn" id="equalBtn" style="grid-column: span 7;">= ВЫЧИСЛИТЬ</button>
                </div>
                
                <!-- Нотный стан -->
                <div class="note-staff" id="noteStaff">
                    <div style="position: relative; font-family: Petrucci; font-size: 200%; height: 100px;">
                        <span style="position: absolute; left: 10px; top: 5px;">&amp;</span>
                        <span style="position: absolute; left: 50px; top: 5px; letter-spacing: 2px;">===========================</span>
                        
                        <div class="note-on-staff" id="staff_note_1" style="position: absolute; left: 110px; top: 10px; display: none;">w</div>
                        <div class="note-on-staff" id="staff_note_2" style="position: absolute; left: 210px; top: 10px; display: none;">w</div>
                        <div class="note-on-staff" id="staff_note_3" style="position: absolute; left: 260px; top: 10px; display: none;">w</div>
                        
                        <div class="note-on-staff" id="staff_sign_1" style="position: absolute; left: 96px; top: 10px; font-size: 16px; display: none;"></div>
                        <div class="note-on-staff" id="staff_sign_2" style="position: absolute; left: 196px; top: 10px; font-size: 16px; display: none;"></div>
                        <div class="note-on-staff" id="staff_sign_3" style="position: absolute; left: 246px; top: 10px; font-size: 16px; display: none;"></div>
                    </div>
                </div>
            </div>
        `;
        
        this.updateButtonStates();
    },
    
    updateButtonStates() {
        // Скрываем все спец. кнопки при старте
        const altBtns = document.getElementById('altButtons');
        const ladBtns = document.getElementById('ladButtons');
        const dirBtns = document.getElementById('dirButtons');
        const intervalBtns = document.getElementById('intervalButtons');
        const intervalTypes = document.getElementById('intervalTypes');
        const funcBtns = document.getElementById('funcButtons');
        
        if (altBtns) altBtns.style.opacity = '0.5';
        if (ladBtns) ladBtns.style.opacity = '0.5';
        if (dirBtns) dirBtns.style.opacity = '0.5';
        if (intervalBtns) intervalBtns.style.opacity = '0.5';
        if (intervalTypes) intervalTypes.style.opacity = '0.5';
        if (funcBtns) funcBtns.style.opacity = '0.5';
    },
    
    enableSection(sectionId) {
        const section = document.getElementById(sectionId);
        if (section) section.style.opacity = '1';
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
            } else if (btn.dataset.type) {
                this.handleIntervalTypeClick(btn);
            } else if (btn.dataset.lad) {
                this.handleLadClick(btn);
            } else if (btn.dataset.func) {
                this.handleFuncClick(btn);
            } else if (btn.id === 'clearBtn') {
                this.clear();
            } else if (btn.id === 'equalBtn') {
                this.calculate();
            } else if (btn.dataset.mode) {
                this.setMode(btn.dataset.mode);
            }
        });
    },
    
    handleNoteClick(btn) {
        console.log('🎵 Нота:', btn.dataset.note);
        const note = btn.dataset.note;
        const stup = parseInt(btn.dataset.stup);
        const rel = parseInt(btn.dataset.rel);
        
        if (this.state.mode === 'tonality') {
            this.state.tone_nota = stup;
            this.state.tone_alt = 0;
            this.state.tone_lad = '';
            document.getElementById('operand1').textContent = 'Тональность: ' + note;
            this.enableSection('ladButtons');
            this.enableSection('altButtons');
            return;
        }
        
        if (!this.state.operand1) {
            this.state.operand1 = rel + this.state.alt1;
            this.state.stupen1 = stup;
            document.getElementById('operand1').textContent = 'От ноты: ' + note;
            document.getElementById('alt1').textContent = this.state.alt1 ? MusicCalc.signs[this.state.alt1 + 2] : '';
            this.showNoteOnStaff(1, stup, this.state.alt1);
            this.enableSection('altButtons');
            this.enableSection('dirButtons');
        } else if (!this.state.operand2) {
            this.state.operand2 = rel + this.state.alt2;
            this.state.stupen2 = stup;
            document.getElementById('operand2').textContent = 'до ноты: ' + note;
            document.getElementById('alt2').textContent = this.state.alt2 ? MusicCalc.signs[this.state.alt2 + 2] : '';
            this.showNoteOnStaff(2, stup, this.state.alt2);
            this.calculate();
        }
    },
    
    handleAltClick(btn) {
        const alt = parseInt(btn.dataset.alt);
        console.log('🎵 Альтерация:', alt);
        
        if (this.state.mode === 'tonality' && this.state.tone_nota) {
            this.state.tone_alt = alt;
            document.getElementById('alt1').textContent = MusicCalc.signs[alt + 2];
            return;
        }
        
        if (this.state.operand2) {
            this.state.alt2 = alt;
            document.getElementById('alt2').textContent = MusicCalc.signs[alt + 2];
            if (this.state.stupen2) this.showNoteOnStaff(2, this.state.stupen2, alt);
        } else if (this.state.operand1) {
            this.state.alt1 = alt;
            document.getElementById('alt1').textContent = MusicCalc.signs[alt + 2];
            if (this.state.stupen1) this.showNoteOnStaff(1, this.state.stupen1, alt);
        }
    },
    
    handleDirectionClick(btn) {
        this.state.direction = parseInt(btn.dataset.dir);
        document.getElementById('direction').textContent = btn.dataset.dir === '1' ? '↑' : '↓';
        console.log('🎵 Направление:', this.state.direction);
    },
    
    handleIntervalClick(btn) {
        console.log('🎵 Интервал:', btn.dataset.interval);
        if (this.state.mode === 'note') {
            const intervalNum = parseInt(btn.dataset.interval);
            const semitones = parseInt(btn.dataset.sem);
            
            if (this.state.operand1) {
                const baseNote = this.state.operand1 + this.state.alt1;
                const targetStup = this.state.stupen1 - 1 + this.state.direction * intervalNum;
                const targetNote = baseNote + this.state.direction * semitones;
                
                const noteName = MusicCalc.notes[(targetStup % 7 + 7) % 7];
                const noteNameFull = MusicCalc.notes[(targetStup % 7 + 7) % 7] || MusicCalc.notes[targetStup];
                
                document.getElementById('operand2').textContent = 'Интервал: ' + btn.querySelector('br').nextSibling?.textContent || '';
                this.calculate();
            }
        }
    },
    
    handleIntervalTypeClick(btn) {
        console.log('🎵 Тип интервала:', btn.dataset.type);
        // Заглушка для будущей реализации
    },
    
    handleLadClick(btn) {
        console.log('🎵 Лад:', btn.dataset.lad);
        
        if (this.state.mode === 'tonality' && this.state.tone_nota) {
            this.state.tone_lad = btn.dataset.lad;
            document.getElementById('result').textContent = 'Тональность: ' + 
                MusicCalc.notes[this.state.tone_nota - 1] + ' ' + 
                (this.state.tone_alt ? MusicCalc.signs[this.state.tone_alt + 2] + ' ' : '') + 
                btn.dataset.lad;
            
            const keySigns = MusicCalc.getKeySigns(
                MusicCalc.notes[this.state.tone_nota - 1],
                btn.dataset.lad === 'Мажор' ? 'major' : 'minor'
            );
            
            document.getElementById('alt_int').textContent = 
                keySigns.diezov > 0 ? keySigns.diezov + '♯' : 
                keySigns.bemoley > 0 ? keySigns.bemoley + '♭' : '0 знаков';
        }
        
        this.state.lad = btn.dataset.lad;
        this.enableSection('intervalButtons');
    },
    
    handleFuncClick(btn) {
        console.log('🎵 Функция:', btn.dataset.func);
        // Заглушка для будущей реализации T/S/D
    },
    
    setMode(mode) {
        console.log('🎵 Режим:', mode);
        this.state.mode = mode;
        this.clear();
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
        
        // Включаем нужные секции в зависимости от режима
        this.enableSection('altButtons');
        
        if (mode === 'note') {
            this.enableSection('intervalButtons');
            this.enableSection('intervalTypes');
        }
        if (mode === 'chord') {
            this.enableSection('ladButtons');
            this.enableSection('funcButtons');
        }
    },
    
    calculate() {
        if (!this.state.operand1 || !this.state.operand2) return;
        
        const result = MusicCalc.getInterval(
            this.state.stupen1,
            this.state.alt1,
            this.state.stupen2,
            this.state.alt2
        );
        
        document.getElementById('equal').style.display = 'inline';
        document.getElementById('result').textContent = result.type + ' ' + result.name;
        console.log('✅ Результат:', result);
    },
    
    showNoteOnStaff(noteNum, step, alt) {
        const noteEl = document.getElementById('staff_note_' + noteNum);
        const signEl = document.getElementById('staff_sign_' + noteNum);
        
        if (noteEl) {
            noteEl.style.display = 'block';
            // Позиция ноты на стане (чем выше нота, тем меньше top)
            const topPosition = 50 - step * 5.3;
            noteEl.style.top = topPosition + 'px';
        }
        
        if (signEl) {
            if (alt === 1) {
                signEl.textContent = '#';
                signEl.style.display = 'block';
            } else if (alt === -1) {
                signEl.textContent = 'b';
                signEl.style.display = 'block';
            } else {
                signEl.style.display = 'none';
            }
        }
    },
    
    clear() {
        console.log('🧹 Очистка');
        
        this.state.operand1 = null;
        this.state.operand2 = null;
        this.state.alt1 = 0;
        this.state.alt2 = 0;
        this.state.stupen1 = null;
        this.state.stupen2 = null;
        this.state.tone_nota = null;
        this.state.tone_alt = 0;
        this.state.tone_lad = '';
        this.state.lad = '';
        
        document.getElementById('operand1').textContent = 'Выберите ноту';
        document.getElementById('operand2').textContent = '';
        document.getElementById('alt1').textContent = '';
        document.getElementById('alt2').textContent = '';
        document.getElementById('direction').textContent = '';
        document.getElementById('alt_int').textContent = '';
        document.getElementById('result').textContent = '';
        document.getElementById('equal').style.display = 'none';
        
        for (let i = 1; i <= 3; i++) {
            const noteEl = document.getElementById('staff_note_' + i);
            const signEl = document.getElementById('staff_sign_' + i);
            if (noteEl) noteEl.style.display = 'none';
            if (signEl) signEl.style.display = 'none';
        }
        
        this.updateButtonStates();
    }
};
