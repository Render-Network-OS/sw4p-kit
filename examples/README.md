# @sw4p/kit — examples

Runnable demos of every major kit surface.

| File | What it shows |
|---|---|
| `cart-mandate-flow.ts` | Full AP2 Cart Mandate path: propose → sign → execute → status. Uses a mocked sw4p SDK so it runs offline. |

## Run

Install `tsx` if you don't have it:
```bash
npm i -D tsx
```

Then:
```bash
node --import tsx examples/cart-mandate-flow.ts
```

Expected output ends with `✓ end-to-end Cart Mandate flow complete`.

To run against a real sw4p backend, replace the mock `sdk` block at the top of the file with a real fetch-based SDK pointing at your `SW4P_API_URL` + `SW4P_API_KEY`.
