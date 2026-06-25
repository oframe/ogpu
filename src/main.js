import './style.css';
import '@examples/examples.css';

import { HelloWebGPU } from '@examples/hellowebgpu/HelloWebGPU';
import { Triangle } from '@examples/triangle/Triangle';
import { Particles } from '@examples/particles/Particles';
import { RenderToTexture } from '@examples/rendertotexture/RenderToTexture';
import { PBRShader } from '@examples/pbrshader/PBRShader';
import { Skinning } from '@examples/skinning/Skinning';
import { GLTF } from '@examples/gltf/GLTF';
import { Textures } from '@examples/textures/Textures';
import { KTX } from '@examples/ktx/KTX';
import { Instancing } from '@examples/instancing/Instancing';
import { InstancingPicking } from '@examples/instancingpicking/InstancingPicking';
import { Primitives } from '@examples/primitives/Primitives';
import { Raycasting } from '@examples/raycasting/Raycasting';
import { OrbitControls } from '@examples/orbitcontrols/OrbitControls';
import { Shadowmapping } from '@examples/shadowmapping/Shadowmapping';
import { FrustumCulling } from '@examples/frustumculling/FrustumCulling';
import { ComputeFrustumCulling } from '@examples/computefrustumculling/ComputeFrustumCulling';
import { SceneGraph } from '@examples/scenegraph/SceneGraph';
import { SortTransparency } from '@examples/sorttransparency/SortTransparency';
import { MSAA } from '@examples/msaa/MSAA';
import { CubeMapExample } from '@examples/cubemap/CubeMap';
//TODO: Post FX WebGPU way

const view = new URLSearchParams(window.location.search).get('src');
const canvas = document.getElementById('web-gpu-canvas');

switch (view) {
    case 'rendertargets':
        new RenderToTexture();
        break;
    case 'particles':
        new Particles();
        break;
    case 'textures':
        new Textures();
        break;
    case 'ktx':
        new KTX();
        break;
    case 'instancing':
        new Instancing();
        break;
    case 'instancingpicking':
        new InstancingPicking();
        break;
    case 'primitives':
        new Primitives();
        break;
    case 'raycasting':
        new Raycasting();
        break;
    case 'orbit':
        new OrbitControls();
        break;
    case 'pbrshader':
        new PBRShader();
        break;
    case 'skinning':
        new Skinning(canvas);
        break;
    case 'gltf':
        new GLTF(canvas);
        break;
    case 'shadowmapping':
        new Shadowmapping();
        break;
    case 'frustumculling':
        new FrustumCulling();
        break;
    case 'computefrustumculling':
        new ComputeFrustumCulling();
        break;
    case 'scenegraph':
        new SceneGraph();
        break;
    case 'sorttransparency':
        new SortTransparency();
        break;
    case 'msaa':
        new MSAA();
        break;
    case 'cubemap':
        new CubeMapExample();
        break;
    case 'hellowebgpu':
        new HelloWebGPU();
        break;
    case 'triangle':
        new Triangle();
        break;
    default:
        renderLanding();
}

// Example gallery shown at the root (no ?src=). OGL-style sidebar of links
// + an iframe that previews the selected example. Each example still boots
// directly via its ?src= value — the iframe just loads `./?src=<name>`, and
// the switch above renders it on that document's own canvas. Deep-link the
// parent with `?example=<name>`.
function renderLanding() {
    // Hide the WebGPU canvas + boot loader — the live example lives in the iframe.
    canvas.style.display = 'none';
    document.getElementById('ogpu-loader')?.remove();

    // `section` rows are headers; the rest are example links (folder = source dir).
    const items = [
        { section: 'Getting Started' },
        { view: 'hellowebgpu', label: 'Hello WebGPU', folder: 'hellowebgpu' },
        { view: 'triangle', label: 'Triangle Screen Shader', folder: 'triangle' },
        { section: 'Geometry' },
        { view: 'primitives', label: 'Primitives', folder: 'primitives' },
        { view: 'instancing', label: 'Instancing', folder: 'instancing' },
        { view: 'instancingpicking', label: 'Instancing GPU Picking', folder: 'instancingpicking' },
        { section: 'Scene' },
        { view: 'scenegraph', label: 'Scene Graph', folder: 'scenegraph' },
        { view: 'sorttransparency', label: 'Sort Transparency', folder: 'sorttransparency' },
        { view: 'frustumculling', label: 'Frustum Culling', folder: 'frustumculling' },
        { section: 'Interaction' },
        { view: 'orbit', label: 'Orbit Controls', folder: 'orbitcontrols' },
        { view: 'raycasting', label: 'Projection and Raycasting', folder: 'raycasting' },
        { section: 'Compute' },
        { view: 'particles', label: 'Particles', folder: 'particles' },
        { view: 'computefrustumculling', label: 'Frustum Culling (GPU Compute)', folder: 'computefrustumculling' },
        { section: 'Shading' },
        { view: 'textures', label: 'Textures', folder: 'textures' },
        { view: 'ktx', label: 'Compressed Textures', folder: 'ktx' },
        { view: 'cubemap', label: 'Cube Map', folder: 'cubemap' },
        { view: 'pbrshader', label: 'PBR (Physically Based Rendering)', folder: 'pbrshader' },
        { view: 'msaa', label: 'MSAA', folder: 'msaa' },
        { section: 'Frame Buffer' },
        { view: 'rendertargets', label: 'Render to Texture', folder: 'rendertotexture' },
        { view: 'shadowmapping', label: 'Shadow Maps', folder: 'shadowmapping' },
        { section: 'Loaders' },
        { view: 'gltf', label: 'Load glTF', folder: 'gltf' },
        { section: 'Animation' },
        { view: 'skinning', label: 'Skinning', folder: 'skinning' },
    ];

    const sourcePath = 'https://github.com/oframe/ogpu/tree/main/examples/';
    const links = items
        .map((it) => (it.section ? `<div class="Section">${it.section}</div>` : `<a class="Example" href="?example=${it.view}" data-view="${it.view}" data-folder="${it.folder}">${it.label}</a>`))
        .join('\n');

    document.body.classList.add('Gallery');
    document.body.innerHTML = `
        <div class="Side">
            <a class="Title" href="https://github.com/oframe/ogpu">OGPU</a>
            <div class="SubTitle">Examples</div>
            ${links}
        </div>
        <iframe class="Iframe" allow="autoplay" src=""></iframe>
        <a class="SideIcon" href="#">&lt;</a>
        <a class="CodeIcon" href="" target="_blank">&lt;&#47;&gt;</a>
    `;

    const iframe = document.querySelector('.Iframe');
    const codeIcon = document.querySelector('.CodeIcon');
    const exampleLinks = [...document.querySelectorAll('a.Example')];

    const show = (link) => {
        const { view, folder } = link.dataset;
        iframe.src = `./?src=${view}`;
        codeIcon.href = sourcePath + folder;
        history.replaceState(null, '', `?example=${view}`);
        exampleLinks.forEach((l) => l.classList.toggle('active', l === link));
    };

    exampleLinks.forEach((link) =>
        link.addEventListener('click', (e) => {
            // cmd/ctrl-click opens the example standalone in a new tab.
            if (e.metaKey || e.ctrlKey) {
                window.open(`./?src=${link.dataset.view}`, '_blank');
                return;
            }
            e.preventDefault();
            show(link);
        })
    );

    document.querySelector('.SideIcon').addEventListener('click', (e) => {
        e.preventDefault();
        document.body.toggleAttribute('data-hideSidebar');
    });

    // Deep-link via ?example=<name>, else show a random example.
    const wanted = new URLSearchParams(location.search).get('example');
    const random = exampleLinks[Math.floor(Math.random() * exampleLinks.length)];
    show(exampleLinks.find((l) => l.dataset.view === wanted) ?? random);
}

// new HelloWebGPU();
// new Particles();
// new RenderToTexture();
