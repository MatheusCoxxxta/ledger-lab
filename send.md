# POST /send

- Conta A envia 15 BRL para Conta B.
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{z
    "idempotency_key": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c",
    "sender_id": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "amount": 15,
    "receiver_id": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c"
  }'
```

- Conta B envia 15 BRL para Conta A.
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "sender_id": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c",
    "receiver_id": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "amount": 15
  }'
```
