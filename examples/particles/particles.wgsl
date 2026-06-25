struct Uniforms {
    projectionMatrix : mat4x4f,
    modelViewMatrix: mat4x4f,
    modelMatrix : mat4x4f,
    viewMatrix : mat4x4f,
    cameraPosition: vec3f,
    resolution: vec2f,
    time: f32,
}

@group(0) @binding(0) var <uniform> uniforms: Uniforms;
@group(0) @binding(1) var <storage, read> positionData : array<vec4f>;

struct Vertex {
    @builtin(instance_index) id: u32,
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) data: vec4f
}

struct VertexOutPut {
    @builtin(position) position: vec4f,
    @location(0) vUv : vec2f,
    @location(1) vPos: vec3f,
    @location(2) vWorldPos: vec3f,
    @location(3) vRandom: f32
}

@vertex
fn vs(in: Vertex) -> VertexOutPut {

    var out: VertexOutPut;

    let pos = positionData[in.id].xyz;
    let worldPos = uniforms.modelMatrix * vec4(pos.xyz, 1.0);
    out.vWorldPos = worldPos.xyz;
    out.vPos = in.position;
    out.vRandom = in.data.y;

    var viewPos = uniforms.viewMatrix * worldPos;

    let size = mix(0.5, 1.5, in.data.x);
    viewPos = vec4f(viewPos.xy + in.position.xy * size * 0.01, viewPos.z, viewPos.w);

    out.position = uniforms.projectionMatrix * viewPos;
    out.vUv = in.uv;

    return out;

}

struct FragmentOutput {
    @location(0) color: vec4f
}

@fragment
fn fs(in: VertexOutPut) -> FragmentOutput {
    var out: FragmentOutput;

    var surface = in.vPos;
    let mag = dot(surface.xy, surface.xy);

    if(mag > 1.0) {
        discard;
    }

    let z = max(0.0, sqrt(1.0 - mag));

    //impostor normals
    surface = vec3f(surface.xy, z);
    let mat3View = mat3x3f(
        uniforms.viewMatrix[0].xyz,
        uniforms.viewMatrix[1].xyz,
        uniforms.viewMatrix[2].xyz,
    );

    let normal = normalize(transpose(mat3View) * surface);

    let lightPos = vec3f(0.0, 3.0, 3.0);
    let lightDir = normalize(lightPos - in.vWorldPos);
    let light = dot(lightDir, normal) * 0.5 + 0.5;

    let uv = in.vUv;
    let color = vec3f(0.8) + 0.2 * sin(vec3f(uv.y, uv.x, uv.x) + uniforms.time + in.vRandom * 6.2832) + vec3f(0.1, 0.0, 0.3);

    out.color = vec4f(color * light, 1.0);

    return out;
}