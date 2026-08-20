const nowPlayingBarStyles = new CSSStyleSheet();

nowPlayingBarStyles.replaceSync(`
    .np-view {
    position: fixed;
    right: 10px;
    bottom: 10px;
    left: 10px;
    z-index: 990;

    display: flex;

    flex-direction: column;
    justify-content: center;
    align-items: center;

    max-width: 1200px;
    height: var(--np-view-heigth);

    margin: 0 auto;

    text-align: center;
    }

    .np-card {
    position: relative;

    display: flex;

    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: 15px;

    width: 100%;

    padding: 10px;

    border: 1px solid var(--border);

    border-radius: 20px;

    background: var(--card);

    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    backdrop-filter: blur(5px);

    transition: all 0.3s ease;
    }

    .np-art {
    position: relative;

    display: flex;
    
    overflow: hidden;

    width: 100px;

    height: 100px;

    border: 1px solid var(--border);

    border-radius: 12px;

    background: var(--art-bg);

    box-shadow: 0 5px 15px rgba(0,0,0,0.5);

    object-fit: cover;

    img {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 10;

        width: 100%;

        height: 100%;

        object-fit: cover;
    }
    }

    .np-timer {
    font-size: 1.2rem;

    text-align: left;
    }

    .np-infos {
    display: flex;

    flex-direction: column;
    align-items: flex-start;
    }

    .np-track {
    font-size: 1.6em;

    font-weight: bold;
    line-height: 1.2;

    text-align: left;

    color: var(--text);
    }

    .np-artist {
    font-size: 1.2em;

    text-align: left;

    color: var(--accent);
    }

    .np-album {
    font-size: 1em;

    font-style: italic;

    text-align: left;

    color: var(--text-secondary);
    }

    .np-status-badge {
    position: absolute;
    top: 10px;
    right: 10px;

    padding: 6px 12px;

    border: 1px solid var(--btn-border);

    border-radius: 20px;
    font-size: 0.85em;

    letter-spacing: 1px;

    text-transform: uppercase;

    color: var(--text-secondary);
    background: var(--btn-bg);
    }
`);

class NowPlayingBar extends HTMLElement {
    
    constructor() {
        super();
        this.attachShadow({ mode: 'open'});
        this.shadowRoot.adoptedStyleSheets = [nowPlayingBarStyles];
        this.shadowRoot.innerHTML = /* html */ `
            <footer part="np-view" class="np-view">
                <slot></slot>
            </footer>
        `;


        
    }

    

/*     connectedCallback() {

    } */

    
}



customElements.define("now-playing-bar", NowPlayingBar);