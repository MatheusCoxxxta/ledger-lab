# POST /send

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "aaaa-aaaa-bbbb-cccc",
    "sender_id": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "amount": 15,
    "receiver_id": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c"
  }'
```
