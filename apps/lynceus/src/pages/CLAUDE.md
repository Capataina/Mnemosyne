# src/pages/

One file: `[...slug].tsx`, the single catch-all route (vite-plugin-pages via
`~react-pages`). It is the app's composition root (~1100 lines): owns the one
filter state shared by SearchBar and LibraryDrawer, selection/hero state, the
inspector's nav list, and wires the feed manifest → shuffle → Masonry pipeline
plus all drawers/overlays. There is no second page; navigation state lives in
this component, not the URL.
