/* C&W Masonry clone: three.js transitions (preview, loaded only with ?fx=3d).
   The before / during / after plates and the CLEAR / GRADE / BUILD photos change through a
   scroll-scrubbed "ground being worked" dissolve: the next picture spreads up from the bottom
   through a noise front, the pixels at the front are pushed aside and lit like blown dust.
   Everything else on the page stays as it is; if WebGL is missing the normal crossfades remain. */
(function () {
  if (!window.THREE || !window.gsap || !window.ScrollTrigger) return;
  var THREE = window.THREE;

  var VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D t0; uniform sampler2D t1; uniform sampler2D t2;',
    'uniform float v;            // 0..2: which picture, fractional = mid-change',
    'uniform vec2 res;           // canvas size in px',
    'uniform float ia;           // image aspect (w/h)',
    'uniform vec2 focus;         // focal point, GL uv (y up)',
    'uniform float zoom; uniform float dy;',
    'uniform float boxH;         // story on tall screens: photo band height as share of the screen (1 = full cover)',
    'float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);',
    '  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }',
    'float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 5; k++){ s += a*vn(p); p *= 2.03; a *= .5; } return s; }',
    'vec2 cover(vec2 uv, float ra){',
    '  vec2 s = ra > ia ? vec2(1., ia/ra) : vec2(ra/ia, 1.); s /= zoom;',
    '  vec2 c = clamp(focus + vec2(0., dy), s*.5, 1. - s*.5);',
    '  return c + (uv - .5) * s; }',
    'vec4 pick(int i, vec2 p, float bias){ if (i == 0) return texture2D(t0, p, bias); if (i == 1) return texture2D(t1, p, bias); return texture2D(t2, p, bias); }',
    'vec3 scene(vec2 uv, vec2 disp, int ia_, int ib, float m, float bias){',
    '  float ra = res.x / res.y;',
    '  if (boxH < .999) {',
    '    float y0 = .5 - boxH*.5; vec2 bu = vec2(uv.x, (uv.y - y0) / boxH);',
    '    vec2 pa = cover(bu + disp, res.x / (res.y*boxH)), pb = cover(bu - disp, res.x / (res.y*boxH));',
    '    vec3 sharp = mix(pick(ia_, pa, 0.).rgb, pick(ib, pb, 0.).rgb, m);',
    '    vec2 ca = cover(uv, ra);',
    '    vec3 soft = mix(pick(ia_, ca, 5.5).rgb, pick(ib, ca, 5.5).rgb, m) * .5;',
    '    float f = smoothstep(0., .16, bu.y) * smoothstep(1., .84, bu.y);',
    '    return mix(soft, sharp, f);',
    '  }',
    '  vec2 c = cover(uv, ra);',
    '  return mix(pick(ia_, c + disp, bias).rgb, pick(ib, c - disp, bias).rgb, m);',
    '}',
    'void main(){',
    '  vec2 uv = vUv; float ra = res.x / res.y;',
    '  int ia_ = int(floor(min(v, 1.999))); int ib = ia_ + 1; float t = v - float(ia_);',
    '  if (ib > 2) { ib = 2; }',
    '  vec2 q = vec2(uv.x * ra, uv.y) * 2.2;',
    '  float n = fbm(q + vec2(0., t * .8));',
    '  float g = n * .62 + (1. - uv.y) * .38;           // the ground changes first, the sky last',
    '  float edge = mix(1.12, -.12, t);',
    '  float m = smoothstep(edge - .045, edge + .045, g);',
    '  float band = 1. - smoothstep(0., .1, abs(g - edge));',
    '  band *= step(.002, t) * step(t, .998);',
    '  vec2 disp = (vec2(fbm(q*1.7 + 3.1), fbm(q*1.7 + 7.7)) - .5) * .07 * band;',
    '  vec3 col = scene(uv, disp, ia_, ib, m, band * 1.2);',
    '  vec3 dust = vec3(.78, .62, .45);',
    '  col = mix(col, col * .6 + dust * .5, band * .45);',
    '  col += dust * pow(band, 3.) * .18;',
    '  gl_FragColor = vec4(col, 1.);',
    '}'
  ].join('\n');

  function bigSrc(srcs) { var w = window.innerWidth * Math.min(2, window.devicePixelRatio || 1); return w > 1100 ? srcs[0] : srcs[1]; }

  function Stage(host, srcs, opts) {
    var self = this; this.ok = false; this.v = 0; this.drift = 0; this.opts = opts;
    var canvas = document.createElement('canvas'); canvas.className = 'gl-stage'; canvas.setAttribute('aria-hidden', 'true');
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); }
    catch (e) { return; }
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    var loader = new THREE.TextureLoader(), left = srcs.length, tex = [];
    this.u = {
      t0: { value: null }, t1: { value: null }, t2: { value: null }, v: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
      ia: { value: 16 / 9 }, focus: { value: new THREE.Vector2(.5, .5) }, zoom: { value: 1 }, dy: { value: 0 }, boxH: { value: 1 }
    };
    var mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false });
    var scene = new THREE.Scene(), cam = new THREE.Camera(); scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    srcs.forEach(function (s, i) {
      loader.load(bigSrc(s), function (t) {
        t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.encoding = THREE.sRGBEncoding;
        tex[i] = t; self.u['t' + i].value = t; if (i === 0) self.u.ia.value = t.image.width / t.image.height;
        if (--left === 0) { self.ok = true; host.insertBefore(canvas, opts.before ? host.querySelector(opts.before) : null); host.classList.add('gl-on'); self.size(); }
      }, undefined, function () { left = -1; });
    });
    renderer.outputEncoding = THREE.sRGBEncoding;
    this.size = function () {
      if (!self.ok) return; var r = host.getBoundingClientRect(); var w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height));
      renderer.setSize(w, hh, false); self.u.res.value.set(w, hh); opts.layout && opts.layout(self.u, w, hh); self.draw();
    };
    var queued = false;
    this.draw = function () {
      if (!self.ok || queued) return; queued = true;
      requestAnimationFrame(function () { queued = false; self.u.v.value = self.v; opts.frame && opts.frame(self.u, self); renderer.render(scene, cam); });
    };
    this.set = function (v, drift) { self.v = v; if (drift != null) self.drift = drift; self.draw(); };
    window.addEventListener('resize', function () { self.size(); });
  }

  /* scroll progress → picture index: each change happens over its own stretch of the scroll */
  function steps(p, marks, w) {
    var v = 0; for (var i = 0; i < marks.length; i++) v += gsap.utils.clamp(0, 1, (p - (marks[i] - w)) / (2 * w)); return v;
  }

  var stages = {}, triggers = {};
  /* the pinned sections sit inside GSAP's pin spacer; measure from the spacer so the start is where the pin starts */
  function outer(el) { return el && el.parentNode && el.parentNode.classList.contains('pin-spacer') ? el.parentNode : el; }
  function srcSet(img) {
    var base = (img.currentSrc || img.src).replace(/-(\d+)\.(jpg|webp)(\?.*)?$/, '');
    var big = /hero-/.test(base) ? '-2048.jpg' : '-1600.jpg';
    return [base + big, base + '-1024.jpg'];
  }

  function mount(view, name) {
    (triggers[name] || []).forEach(function (t) { t.kill(); }); triggers[name] = [];
    var heroStage = view.querySelector('.hero .plates');
    var heroImgs = Array.prototype.map.call(view.querySelectorAll('.plate img'), function (i) { return i; });
    if (name === 'home' && heroStage && heroImgs.length >= 3) {
      if (!stages.hero) stages.hero = new Stage(heroStage, heroImgs.slice(0, 3).map(srcSet), {
        layout: function (u, w, hh) { u.focus.value.set(w < 700 ? .44 : .5, 1 - .62); },
        frame: function (u, s) { u.zoom.value = 1 + .03 * s.drift; u.dy.value = .04 * s.drift; }
      });
      var st = stages.hero;
      triggers[name].push(ScrollTrigger.create({ trigger: outer(view.querySelector('.hero')), start: 'top top', end: '+=156%', onRefresh: function () { st.size(); },
        onUpdate: function (self) { st.set(steps(self.progress, [.36, .7], .1), self.progress); } }));
      st.set(0, 0);
    }
    var storyHost = view.querySelector('.story-bgs');
    var storyImgs = view.querySelectorAll('.story-bg img');
    if (name === 'home' && storyHost && storyImgs.length >= 3) {
      if (!stages.story) stages.story = new Stage(storyHost, Array.prototype.slice.call(storyImgs, 0, 3).map(srcSet), {
        layout: function (u, w, hh) { var tall = w / hh <= 1.25; u.boxH.value = tall ? Math.min(1, (w / (w < 600 ? 1 : 1.24)) / hh) : 1; u.focus.value.set(.5, .5); },
        before: '.story-scrim',
        frame: function (u, s) { u.zoom.value = u.boxH.value < .999 ? 1 : 1.05; u.dy.value = .03 - .06 * s.drift; }
      });
      var ss = stages.story, n = view.querySelectorAll('.word').length;
      triggers[name].push(ScrollTrigger.create({ trigger: outer(view.querySelector('.story')), start: 'top top', end: '+=' + (n * 60) + '%', onRefresh: function () { ss.size(); },
        onUpdate: function (self) { ss.set(steps(self.progress, [1 / n, 2 / n], .07), self.progress); } }));
      ss.set(0, 0);
    }
  }
  window.CW_GL = { mount: mount, stages: stages, triggers: triggers };
  document.dispatchEvent(new Event('cwgl'));
})();
