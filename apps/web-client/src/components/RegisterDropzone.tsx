'use client';
import { useRef, useState } from 'react';
import { api, RegisterRow } from '@/lib/api';

export type RecognizedRegister = {
  items: RegisterRow[];
  total_rows: number;
  parsed_rows: number;
  warning_rows: number;
};

// Загрузка реестра счетов (Excel/CSV, выгрузка из 1С/МойСклад/СБИС) с автораспознаванием
// строк. Результат — построчный черновик, который нужно проверить перед импортом:
// распознавание эвристическое, столбцы и форматы у всех систем разные.
export default function RegisterDropzone({ onRecognized }: { onRecognized: (r: RecognizedRegister) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const res = await api.documents.recognizeRegister(file);
      onRecognized(res.data);
    } catch (e: any) {
      setError(e.message || 'Не удалось распознать реестр');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        marginBottom: 16, border: dragOver ? '2px dashed var(--accent)' : '2px dashed var(--border)',
        background: dragOver ? 'var(--accent-light)' : undefined,
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <div className="card-body" style={{ textAlign: 'center', padding: '20px 16px' }}>
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        {busy ? (
          <div>⏳ Распознаём реестр…</div>
        ) : (
          <>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              Перетащите сюда реестр счетов
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>
              Таблица со счетами, выгруженная из 1С, МойСклад или СБИС — XLSX, XLS или CSV.
              Поля строк заполнятся автоматически, проверьте перед импортом.
            </div>
            <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>
              Выбрать файл
            </button>
          </>
        )}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
