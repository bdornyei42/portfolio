import fs from 'node:fs';
import { categorize } from './private/categorize.js';
const data = JSON.parse(fs.readFileSync('./private/categorized-transactions.json','utf8'));
const payload = {
  accounts: data.accounts,
  transactions: data.transactions.map(t=>({...t, category: categorize(t.description, t.amount)})),
  syncedAt: new Date().toISOString(),
};
fs.writeFileSync('_payload.json', JSON.stringify(payload));
console.log('wrote _payload.json:', payload.transactions.length, 'tx,', payload.accounts.length, 'accounts');
