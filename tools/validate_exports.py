#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验导出的 STL / 3MF / OBJ：字节数、法向、体积、ZIP CRC、XML 命名空间、索引范围"""
import struct, sys, zipfile, re, xml.etree.ElementTree as ET

def check_stl(path):
    with open(path, 'rb') as f:
        data = f.read()
    n = struct.unpack('<I', data[80:84])[0]
    expect = 84 + n * 50
    print(f'[STL] {path}')
    print(f'  文件大小 {len(data)} 字节，面数 {n}，理论大小 {expect} → {"一致" if len(data)==expect else "不一致!"}')
    assert len(data) == expect, 'STL 长度不符'
    bad_len = bad_norm = 0
    vol = 0.0
    area = 0.0
    for i in range(n):
        off = 84 + i * 50
        nx, ny, nz = struct.unpack('<3f', data[off:off+12])
        v = struct.unpack('<9f', data[off+12:off+48])
        L = (nx*nx + ny*ny + nz*nz) ** 0.5
        if abs(L - 1.0) > 1e-3:
            bad_len += 1
        ux, uy, uz = v[3]-v[0], v[4]-v[1], v[5]-v[2]
        wx, wy, wz = v[6]-v[0], v[7]-v[1], v[8]-v[2]
        cx = uy*wz - uz*wy; cy = uz*wx - ux*wz; cz = ux*wy - uy*wx
        cl = (cx*cx+cy*cy+cz*cz) ** 0.5
        if cl < 1e-12:
            continue
        if (cx*nx + cy*ny + cz*nz)/cl < 0.999:
            bad_norm += 1
        area += cl / 2
        vol += (v[0]*(v[4]*v[8]-v[5]*v[7]) - v[1]*(v[3]*v[8]-v[5]*v[6]) + v[2]*(v[3]*v[7]-v[4]*v[6]))/6
    print(f'  法向非单位 {bad_len} 个，法向与面朝向不一致 {bad_norm} 个')
    print(f'  实体体积 {vol/1000:.2f} cm³，表面积 {area/100:.2f} cm²')
    assert bad_len == 0 and bad_norm == 0, 'STL 法向异常'
    return n, vol/1000

def check_3mf(path):
    print(f'[3MF] {path}')
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        names = z.namelist()
        print(f'  ZIP 条目 {names}，CRC 校验 {"全部通过" if bad is None else "失败:"+bad}')
        assert bad is None
        assert '3D/3dmodel.model' in names, '缺少 3D/3dmodel.model'
        xml = z.read('3D/3dmodel.model').decode('utf-8')
    root = ET.fromstring(xml)
    ns = root.tag.split('}')[0].strip('{')
    print(f'  根元素 {root.tag}，命名空间 {ns}')
    assert ns == 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02', '3MF 命名空间不符'
    objs = root.findall('.//{*}object')
    model = None
    for o in objs:
        if o.get('type') == 'model':
            model = o
    assert model is not None, '未找到 model object'
    mesh = model.find('.//{*}mesh')
    verts = mesh.findall('./{*}vertices/{*}vertex')
    tris = mesh.findall('./{*}triangles/{*}triangle')
    print(f'  顶点 {len(verts)}，三角面 {len(tris)}')
    nv = len(verts)
    maxidx = -1
    for t in tris:
        for a in t.attrib.values():
            maxidx = max(maxidx, int(a))
    print(f'  最大索引 {maxidx} / 顶点数 {nv} → {"在范围内" if maxidx < nv else "越界!"}')
    assert maxidx < nv, '3MF 索引越界'
    assert len(tris) > 0
    return len(tris)

def check_obj(path):
    print(f'[OBJ] {path}')
    nv = nf = 0
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.startswith('v '): nv += 1
            elif line.startswith('f '): nf += 1
    print(f'  顶点 {nv}，面 {nf}')
    assert nf > 0
    return nf

if __name__ == '__main__':
    check_stl('build/out_stl')
    check_3mf('build/out_3mf')
    check_obj('build/out_obj')
    print('\n全部导出文件校验通过 ✓')
