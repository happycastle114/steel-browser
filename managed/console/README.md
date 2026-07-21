# Steel Managed Console

The console is the same-origin operator surface for the managed Steel control plane. It never receives or constructs a private worker address.

## Runtime boundary

- Vite builds the application with the `/ui/` base path.
- `src/api/client.ts` is the only HTTP boundary. It validates every response before data reaches React.
- Browser actions always carry an explicit managed session ID.
- Live-view and cast URLs must match the public origin, requested session, and canonical route before the viewer is enabled.
- Test fixtures live under `test/` only and are not included in the production bundle.

The browser-safe Zod schemas under `src/api/` mirror the shared control-plane contract. Keep contract changes localized to this directory so feature components continue to consume inferred, closed types.

## Node 22 gates

```sh
npm run typecheck -w @happycastle/steel-managed-console
npm test -w @happycastle/steel-managed-console
npm run build -w @happycastle/steel-managed-console
npm run react-doctor -w @happycastle/steel-managed-console
npm run test:visual -w @happycastle/steel-managed-console
```

`react-grab` and `react-scan` are loaded only in the Vite development branch. Production asset checks should confirm neither package name is present in `build/`.
