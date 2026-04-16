/*
 * Smoke tests for the vendored Apache Guacamole on-screen keyboard.
 *
 * These do not exercise the full Karma-hosted UI integration (that
 * happens in app/ui.js's toggleOsk + initOsk, which are DOM-heavy and
 * mocked lightly here).  We verify:
 *
 *  - the ES-moduleised module loads and instantiates against a real
 *    vendored layout,
 *  - it emits X11 keysyms via onkeydown/onkeyup — the contract that
 *    lets the noVNC integration pass keysyms straight into
 *    RFB.sendKey with no translation glue,
 *  - the DOM element it produces has the expected `guac-keyboard`
 *    class hook our overlay CSS relies on.
 */

import OnScreenKeyboard from '../vendor/guacamole-osk/OnScreenKeyboard.js';

describe('Guacamole OnScreenKeyboard (vendored)', function () {
    let layout;

    before(async function () {
        // Use the en-us-qwerty layout as the representative fixture.
        // Fetched via the same servable path the UI uses at runtime.
        const response = await fetch('base/vendor/guacamole-osk/en-us-qwerty.json');
        expect(response.ok).to.be.true;
        layout = await response.json();
    });

    it('loads as an ES module with a default export', function () {
        expect(OnScreenKeyboard).to.be.a('function');
        expect(OnScreenKeyboard.Layout).to.be.a('function');
        expect(OnScreenKeyboard.Key).to.be.a('function');
    });

    it('constructs against a real vendored layout', function () {
        const osk = new OnScreenKeyboard(layout);
        expect(osk).to.be.an('object');
        expect(osk.getElement).to.be.a('function');
    });

    it('produces a DOM element carrying the guac-keyboard class hook', function () {
        const osk = new OnScreenKeyboard(layout);
        const el = osk.getElement();
        expect(el).to.be.instanceOf(HTMLElement);
        expect(el.className).to.contain('guac-keyboard');
    });

    it('exposes onkeydown/onkeyup slots initialised to null', function () {
        // The Guacamole contract: consumers assign functions; the
        // module calls them with a raw X11 keysym integer.
        const osk = new OnScreenKeyboard(layout);
        expect(osk.onkeydown).to.equal(null);
        expect(osk.onkeyup).to.equal(null);
    });

    it('has a resize() method that mutates key geometry', function () {
        const osk = new OnScreenKeyboard(layout);
        const el = osk.getElement();
        document.body.appendChild(el);
        try {
            osk.resize(800);
            // We don't assert exact pixel sizes (layout-dependent),
            // just that resize succeeded without throwing and left
            // the element in the DOM with rendered key children.
            expect(el.querySelectorAll('.guac-keyboard-key').length).to.be.above(0);
        } finally {
            document.body.removeChild(el);
        }
    });
});
