import express from 'express';

const app = express();
app.use(express.json());

interface User {
  id: number;
  name: string;
  email: string;
  age: number;
}

const users: User[] = [];
let nextId = 1;

app.post('/api/users', (req, res) => {
  const { name, email, age } = req.body;
  const user: User = { id: nextId++, name, email, age };
  users.push(user);
  res.status(201).json(user);
});

app.get('/api/users', (_req, res) => {
  res.json(users);
});

export default app;
