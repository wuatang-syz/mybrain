import {describe,it,expect,vi} from 'vitest';
vi.mock('obsidian',()=>({PluginSettingTab:class {},Setting:class {},Modal:class {}}));
import {loadBrainData} from '../src/settings';
import {defaultShortcuts} from '../src/shortcuts';
import {DEFAULT_MIND_MAP} from '../src/mind-map-settings';
describe('persisted state validation',()=>{
  it('uses offline desktop defaults for absent data',()=>{
    const data=loadBrainData(null);expect(data.settings).toEqual({maxNodes:200,newNoteFolder:'',followActive:false,shortcuts:defaultShortcuts(),mindMap:DEFAULT_MIND_MAP});expect(data.focus).toBe('/');
  });
  it('bounds nodes and discards corrupt layout points',()=>{
    const data=loadBrainData({version:4,settings:{maxNodes:1000},layouts:{'note.md':{positions:{valid:{x:20,y:50},bad:{x:'no',y:5}},pinned:['valid','bad'],viewport:{x:0,y:0,scale:20}}}});
    expect(data.settings.maxNodes).toBe(200);expect(data.layouts['note.md']?.positions).toEqual({valid:{x:20,y:50}});
    expect(data.layouts['note.md']?.pinned).toEqual(['valid']);expect(data.layouts['note.md']?.viewport?.scale).toBe(3);
  });
  it('migrates old data to the vault root and persists validated shared positions', () => {
    const legacy = loadBrainData({focus: 'A.md'});
    expect(legacy.globalRoot).toBe('/'); expect(legacy.version).toBe(4);
    const restored = loadBrainData({version: 4, globalRoot: 'Root.md', outerLayout: {positions: {A: {x: 10, y: 20}, B: {x: NaN, y: 0}}, pinned: ['A', 'B']}});
    expect(restored.globalRoot).toBe('/');
    expect(restored).not.toHaveProperty('outerLayout');
    expect(loadBrainData({globalRoot: 12}).globalRoot).toBe('/');
  });
});
