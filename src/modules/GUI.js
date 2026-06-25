import { Pane } from 'tweakpane';

/**
 * Thin wrapper around Tweakpane's `Pane`.
 *
 * Exposes the raw pane on `this.pane` for anything not covered here, plus a few
 * engine-aware helpers:
 *
 *   gui.add(obj, 'key', opts)            // bind a single property, returns the binding
 *   gui.uniform(pipeline, 'uScale', opts) // bind a shader uniform; writes + uploads on change
 *   gui.button('Label', () => {...})      // action button
 *   gui.folder('Title')                   // returns a sub-GUI scoped to a folder
 *   gui.monitor(obj, 'key', opts)         // read-only readout (e.g. fps)
 *
 * `opts` are passed straight through to Tweakpane (min/max/step/label/options/…).
 */
export class GUI {
    constructor({ title = 'OGPU', expanded = true, container, pane } = {}) {
        // Allow nesting: a folder hands its FolderApi in as `pane`.
        this.pane = pane ?? new Pane({ title, expanded, container });
        this._ownsPane = !pane;
    }

    add(obj, key, opts = {}) {
        return this.pane.addBinding(obj, key, opts);
    }

    monitor(obj, key, opts = {}) {
        return this.pane.addBinding(obj, key, { readonly: true, ...opts });
    }

    button(title, onClick) {
        const btn = this.pane.addButton({ title });
        btn.on('click', onClick);
        return btn;
    }

    folder(title, { expanded = true } = {}) {
        const folder = this.pane.addFolder({ title, expanded });
        return new GUI({ pane: folder });
    }

    /**
     * Bind a uniform on any object that owns a structured uniform view + buffer
     * (a `Mesh`, or a pass that owns its uniforms). Tweakpane edits a local proxy;
     * every change pushes the value through `target.uniforms.set` and writes the
     * buffer to the GPU. `target` must expose `.uniforms`, `.uniformBuffer`, `.gpu`.
     */
    uniform(target, key, opts = {}) {
        const view = target.uniforms.views?.[key];
        // Scalars are length-1 typed-array views → unwrap to a number; vecs stay arrays.
        let initial = 0;
        if (view != null) initial = view.length > 1 ? Array.from(view) : view[0];
        const proxy = { [key]: opts.value ?? initial };
        delete opts.value;

        const write = () => {
            target.uniforms.set({ [key]: proxy[key] });
            target.gpu.device.queue.writeBuffer(target.uniformBuffer, 0, target.uniforms.arrayBuffer);
        };

        const binding = this.pane.addBinding(proxy, key, opts);
        binding.on('change', () => write());
        // Apply once so the GPU matches the GUI's starting state.
        write();
        return binding;
    }

    dispose() {
        if (this._ownsPane) this.pane.dispose();
    }
}
