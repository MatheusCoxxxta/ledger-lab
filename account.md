# POST /accounts

```bash
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice",
    "currency": "BRL",
    "balance": 1000
  }'
```
