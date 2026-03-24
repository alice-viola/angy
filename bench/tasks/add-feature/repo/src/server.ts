import express from 'express';

const app = express();
app.use(express.json());

let items: Array<{ id: number; name: string }> = [
  { id: 1, name: 'Item One' },
  { id: 2, name: 'Item Two' },
];
let nextId = 3;

// GET all items
app.get('/api/items', (_req, res) => {
  res.json(items);
});

// GET single item
app.get('/api/items/:id', (req, res) => {
  const item = items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// POST new item
app.post('/api/items', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const item = { id: nextId++, name };
  items.push(item);
  res.status(201).json(item);
});

// PUT update item
app.put('/api/items/:id', (req, res) => {
  const item = items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  item.name = name;
  res.json(item);
});

export { app, items };
