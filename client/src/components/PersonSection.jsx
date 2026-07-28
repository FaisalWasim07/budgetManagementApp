import { useState } from 'react';
import { renamePerson } from '../api/persons';
import { createAccount } from '../api/accounts';
import AccountCard from './AccountCard';
import SalaryTransferForm from './SalaryTransferForm';
import ExpenseEntryForm from './ExpenseEntryForm';
import MultiCurrencyForm from './MultiCurrencyForm';

export default function PersonSection({ person, month, onRefresh }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(person.name);
  const [addingCurrency, setAddingCurrency] = useState(false);

  const primary = person.accounts.find((a) => a.type === 'primary');
  const savings = person.accounts.find((a) => a.type === 'savings');
  const expense = person.accounts.find((a) => a.type === 'expense');
  const multiCurrency = person.accounts.find((a) => a.type === 'multi_currency');

  async function saveName() {
    if (nameDraft.trim() && nameDraft !== person.name) {
      await renamePerson(person.id, nameDraft.trim());
      onRefresh();
    }
    setEditingName(false);
  }

  async function addMultiCurrencyAccount() {
    setAddingCurrency(true);
    try {
      await createAccount({
        person_id: person.id,
        type: 'multi_currency',
        name: 'PKR Savings',
        currency: 'PKR',
      });
      onRefresh();
    } finally {
      setAddingCurrency(false);
    }
  }

  return (
    <section className="card stack">
      {editingName ? (
        <div className="row" style={{ alignItems: 'center' }}>
          <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} style={{ maxWidth: 200 }} />
          <button className="primary" onClick={saveName}>
            Save
          </button>
        </div>
      ) : (
        <h2 onClick={() => setEditingName(true)} style={{ cursor: 'pointer' }} title="Click to rename">
          {person.name}
        </h2>
      )}

      <div className="grid-2">
        {primary && <AccountCard account={primary} />}
        {savings && <AccountCard account={savings} />}
        {expense && <AccountCard account={expense} />}
        {multiCurrency && <AccountCard account={multiCurrency} />}
      </div>

      {primary && (
        <SalaryTransferForm
          personId={person.id}
          month={month}
          monthlyEntry={person.monthlyEntry}
          onSaved={onRefresh}
        />
      )}

      {expense && <ExpenseEntryForm accountId={expense.id} month={month} onSaved={onRefresh} />}

      {multiCurrency ? (
        <MultiCurrencyForm account={multiCurrency} month={month} onSaved={onRefresh} />
      ) : (
        <button onClick={addMultiCurrencyAccount} disabled={addingCurrency}>
          {addingCurrency ? 'Adding…' : '+ Add multi-currency account (PKR)'}
        </button>
      )}
    </section>
  );
}
