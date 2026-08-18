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
        mode: 'interval',
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
                
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;" id="altButtons">
                    <button class="calc-btn mod-btn" data-alt="-1">♭ Бемоль</button>
                    <button class="calc-btn mod-btn" data-alt="1">♯ Диез</button>
                    <button class="calc-btn mod-btn" data-alt="0">♮ Бекар</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;" id="ladButtons">
                    <button class="calc-btn chord-btn" data-lad="Мажор">Dur<br>Мажор</button>
                    <button class="calc-btn chord-btn" data-lad="Минор">moll<br>Минор</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 8px;" id="dirButtons">
                    <button class="calc-btn interval-btn" data-dir="1">↑ Вверх</button>
                    <button class="calc-btn interval-btn" data-dir="-1">↓ Вниз</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;" id="intervalButtons">
                    ${['Прима','Секунда','Терция','Кварта','Квинта','Секста','Септима','Октава','Нона','Децима'].map((name, i) => `
                        <button class="calc-btn interval-btn" data-interval="${i + 1}" data-sem="${MusicCalc.polutonov[i]}">
                            ${i + 1}<br>${name}
                        </button>
                    `).join('')}
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 8px;" id="intervalTypes">
                    <button class="calc-btn mod-btn" data-type="small">М<br>Малая</button>
                    <button class="calc-btn mod-btn" data-type="big">Б<br>Большая</button>
                    <button class="calc-btn mod-btn" data-type="clean">Ч<br>Чистая</button>
                    <button class="calc-btn mod-btn" data-type="aug">Ув<br>Увел.</button>
                </div>
                
                <div class="calc-grid" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;" id="funcButtons">
                    <button class="calc-btn mod-btn" data-func="t">T<br>Тоника</button>
                    <button class="calc-btn mod-btn" data-func="s">S<br>Субдом.</button>
                    <button class="calc-btn mod-btn" data-func="d">D<br>Домин.</button>
                </div>
                
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn clear-btn" id="clearBtn">ОЧИСТИТЬ</button>
                </div>
                
                <div class="calc-grid" style="margin-top: 8px;">
                    <button class="calc-btn chord-btn" id="equalBtn" style="grid-column: span 7;">= ВЫЧИСЛИТЬ</button>
                </div>
                
                <div class="note-staff" id="noteStaff">
                    <div class="staff-wrapper">
                        <span class="staff-clef">&amp;</span>
                        <span class="staff-lines">===============================================</span>
                        <div class="note-on-staff" id="staff_note_1" style="left: 130px; top: 48px;">w</div>
                        <div class="note-on-staff" id="staff_note_2" style="left: 230px; top: 48px;">w</div>
                        <div class="note-on-staff" id="staff_note_3" style="left: 330px; top: 48px;">w</div>
                        <div class="sign-on-staff" id="staff_sign_1" style="left: 116px; top: 42px;"></div>
                        <div class="sign-on-staff" id="staff_sign_2" style="left: 216px; top: 42px;"></div>
                        <div class="sign-on-staff" id="staff_sign_3" style="left: 316px; top: 42px;"></div>
                    </div>
                </div>
            </div>
        `;
        
        this.updateButtonStates();
    },
    
    updateButtonStates() {
        const sections = ['altButtons', 'ladButtons', 'dirButtons', 'intervalButtons', 'intervalTypes', 'funcButtons'];
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.opacity = '0.5';
        });
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
            
            if (btn.dataset.note) this.handleNoteClick(btn);
            else if (btn.dataset.alt !== undefined) this.handleAltClick(btn);
            else if (btn.dataset.dir) this.handleDirectionClick(btn);
            else if (btn.dataset.interval) this.handleIntervalClick(btn);
            else if (btn.dataset.type) this.handleIntervalTypeClick(btn);
            else if (btn.dataset.lad) this.handleLadClick(btn);
            else if (btn.dataset.func) this.handleFuncClick(btn);
            else if (btn.id === 'clearBtn') this.clear();
            else if (btn.id === 'equalBtn') this.calculate();
            else if (btn.dataset.mode) this.setMode(btn.dataset.mode);
        });
    },
    
    handleNoteClick(btn) {
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
    },
    
    handleIntervalClick(btn) {
        if (this.state.mode === 'note' && this.state.operand1) {
            document.getElementById('operand2').textContent = 'Интервал: ' + (btn.textContent?.trim() || '');
            this.calculate();
        }
    },
    
    handleIntervalTypeClick(btn) {
        console.log('Тип интервала:', btn.dataset.type);
    },
    
    handleLadClick(btn) {
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
        console.log('Функция:', btn.dataset.func);
    },
    
    setMode(mode) {
        this.state.mode = mode;
        this.clear();
        
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-mode="${mode}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        
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
    },
    
    showNoteOnStaff(noteNum, step, alt) {
        const noteEl = document.getElementById('staff_note_' + noteNum);
        const signEl = document.getElementById('staff_sign_' + noteNum);
        
        if (noteEl) {
            noteEl.style.display = 'block';
            const positions = {
                1: 80, 2: 72, 3: 64, 4: 56, 5: 48, 6: 40, 7: 32,
                8: 24, 9: 16, 10: 8, 11: 0, 12: -8
            };
            noteEl.style.top = (positions[step] || 48) + 'px';
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
            if (noteEl) signEl.style.top = (parseInt(noteEl.style.top) - 6) + 'px';
        }
    },
    
    clear() {
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
