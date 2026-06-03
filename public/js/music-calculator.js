// public/js/music-calculator.js
// Музыкальный движок - чистая логика без DOM

const MusicCalc = {
    // Константы из твоего примера
    notes: ["До", "Ре", "Ми", "Фа", "Соль", "Ля", "Си", "До", "Ре", "Ми", "Фа", "Соль", "Ля", "Си", "До", "Ре", "Ми", "Фа", "Соль", "Ля", "Си"],
    signs: ["дубль-бемоль", "бемоль", "", "диез", "дубль-диез"],
    signs_symb: ["bb", "b", "", "#", "x"],
    
    // Полутона для каждой ступени
    polutonov: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 29, 31, 33, 35, 36],
    
    intervals: ["Прима", "Секунда", "Терция", "Кварта", "Квинта", "Секста", "Септима", "Октава", "Нона", "Децима"],
    interval_types: ["Чистая", "Малая", "Большая", "Малая", "Большая", "Чистая", "", "Чистая", "Малая", "Большая", "Малая", "Большая", "Чистая", "Малая", "Большая", "Малая", "Большая"],
    interval_types_breaf: ["ч.", "м.", "б.", "м.", "б.", "ч.", "", "ч.", "м.", "б.", "м.", "б.", "ч.", "м.", "б.", "м.", "б."],
    
    // Знаки в тональностях
    majors: [5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 12],
    minors: [2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9],
    
    structure: {
        "Мажор": [0, 2, 4, 5, 7, 9, 11],
        "Минор": [0, 2, 3, 5, 7, 8, 10]
    },
    
    // Вспомогательные функции
    getPolutonov(step) {
        return this.polutonov[step] || 0;
    },
    
    // Определить интервал
    getInterval(note1, alt1, note2, alt2) {
        const s1 = this.getPolutonov(note1 - 1) + (alt1 || 0);
        const s2 = this.getPolutonov(note2 - 1) + (alt2 || 0);
        const diff = (s2 - s1 + 12) % 12;
        
        const steps = Math.abs(note2 - note1) % 7;
        const type = this.interval_types[diff] || '';
        
        return {
            type: type,
            name: this.intervals[steps],
            short: this.interval_types_breaf[diff] + (steps + 1),
            semitones: diff
        };
    },
    
    // Построить аккорд
    buildChord(root, type = 'major') {
        const rootIdx = this.notes.indexOf(root);
        if (rootIdx === -1) return null;
        
        const rootSem = this.getPolutonov(rootIdx);
        
        if (type === 'major') {
            return [
                { note: this.notes[rootIdx], semitone: rootSem },
                { note: this.notes[(rootIdx + 2) % 7] || this.notes[rootIdx + 2], semitone: rootSem + 4 },
                { note: this.notes[(rootIdx + 4) % 7] || this.notes[rootIdx + 4], semitone: rootSem + 7 }
            ];
        }
        if (type === 'minor') {
            return [
                { note: this.notes[rootIdx], semitone: rootSem },
                { note: this.notes[(rootIdx + 2) % 7] || this.notes[rootIdx + 2], semitone: rootSem + 3 },
                { note: this.notes[(rootIdx + 4) % 7] || this.notes[rootIdx + 4], semitone: rootSem + 7 }
            ];
        }
    },
    
    // Определить аккорд по нотам
    identifyChord(notes) {
        // notes - массив полутонов
        if (notes.length === 3) {
            const intervals = [
                (notes[1] - notes[0] + 12) % 12,
                (notes[2] - notes[0] + 12) % 12
            ];
            
            if (intervals[0] === 4 && intervals[1] === 7) return 'Мажорное трезвучие';
            if (intervals[0] === 3 && intervals[1] === 7) return 'Минорное трезвучие';
            if (intervals[0] === 3 && intervals[1] === 6) return 'Уменьшенное трезвучие';
            if (intervals[0] === 4 && intervals[1] === 8) return 'Увеличенное трезвучие';
        }
        return 'Неизвестный аккорд';
    },
    
    // Получить знаки в тональности
    getKeySigns(tonic, mode = 'major') {
        const tonicIdx = this.notes.indexOf(tonic);
        if (tonicIdx === -1) return { diezov: 0, bemoley: 0 };
        
        const semitone = this.getPolutonov(tonicIdx);
        let diezov = mode === 'major' ? this.majors[semitone] : this.minors[semitone];
        
        let bemoley = 0;
        if (diezov > 6) {
            bemoley = 12 - diezov;
            diezov = 0;
        }
        
        return { diezov, bemoley };
    }
};

// Экспорт для использования в других скриптах
if (typeof module !== 'undefined') {
    module.exports = MusicCalc;
}
