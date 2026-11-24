import {useEffect, useRef, useState} from 'react';
import {entityFields, names, recordName} from './presentation';
import type {CrmConfig, CrmRow, Entity, Records} from './types';

type EditorProps = {
  entity: Entity;
  row?: CrmRow;
  records: Records;
  config: CrmConfig;
  close(): void;
  save(entity: Entity, input: CrmRow['data'], row?: CrmRow): Promise<void>;
  remove(entity: Entity, row: CrmRow): Promise<void>;
};

export function RecordEditor({entity, row, records, config, close, save, remove}: EditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const formElement = useRef<HTMLFormElement>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = entityFields(entity, records, config);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit(formNode: HTMLFormElement) {
    if (working || confirmDelete || !formNode.reportValidity()) return;
    const input: CrmRow['data'] = {};
    const form = new FormData(formNode);
    for (const field of fields) {
      const value = String(form.get(field.key) || '').trim();
      if (value || field.required) input[field.key] = field.type === 'money' ? Math.round(Number(value) * 100) : value;
    }
    await run(() => save(entity, input, row));
  }
  async function run(action: () => Promise<void>) {
    setWorking(true);
    setProblem('');
    try { await action(); close(); }
    catch (error) { setProblem(error instanceof Error ? error.message : 'Could not save the record.'); }
    finally { setWorking(false); }
  }

  return <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onCancel={event => {event.preventDefault(); if (!working) close();}}>
    <header className="editor-heading">
      <h2 id="editor-title">{row ? 'Edit' : 'New'} {names[entity].toLowerCase()}</h2>
      <button type="button" className="button icon-button" aria-label="Close editor" onClick={close} disabled={working}>×</button>
    </header>
    <form ref={formElement} onSubmit={event => {event.preventDefault(); void submit(event.currentTarget);}}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          void submit(event.currentTarget);
        }
      }}>
      <fieldset disabled={working || confirmDelete} className="edit-fields">
        {fields.map(field => {
          const current = row?.data[field.key];
          const value = field.type === 'money' && typeof current === 'number' ? (current / 100).toFixed(2) : String(current ?? '');
          return <label key={field.key} className={field.type === 'notes' ? 'full-width' : ''}>
            <span>{field.label}{field.type === 'money' ? ' (' + (config.crm?.currency || 'USD') + ')' : ''}</span>
            {field.type === 'select' ? <select name={field.key} required={field.required} defaultValue={value}>
              <option value="" disabled={field.required}>Select {field.label.toLowerCase()}</option>
              {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select> : field.type === 'notes' ? <textarea name={field.key} rows={3} maxLength={1000} defaultValue={value}/> :
              <input name={field.key} required={field.required} defaultValue={value}
                type={field.type === 'money' ? 'number' : field.type}
                maxLength={field.type === 'email' ? 254 : field.key === 'website' ? 250 : 120}
                min={field.type === 'money' ? '0' : undefined} max={field.type === 'money' ? '1000000000' : undefined}
                step={field.type === 'money' ? '.01' : undefined}/>}
          </label>;
        })}
      </fieldset>
      {problem && <p className="problem" role="alert">{problem}</p>}
      {row && confirmDelete ? <div className="confirm">
        <p>Delete {recordName(row)}?</p>
        <div className="editor-actions">
          <button type="button" className="button" onClick={() => setConfirmDelete(false)} disabled={working}>Keep record</button>
          <button type="button" className="button danger" onClick={() => void run(() => remove(entity, row))} disabled={working}>Delete record</button>
        </div>
      </div> : <div className="editor-actions">
        {row && <button type="button" className="button quiet danger" onClick={() => setConfirmDelete(true)} disabled={working}>Delete</button>}
        <button type="button" className="button primary" disabled={working} onClick={() => {
          if (formElement.current) void submit(formElement.current);
        }}>{working ? 'Saving…' : 'Save record'}</button>
      </div>}
    </form>
  </dialog>;
}
