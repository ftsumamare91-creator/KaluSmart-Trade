import { buildCategoryTree } from './category-tree';

const rows = [
  { id: 'a', parentId: null, isActive: true, nameAm: 'ልብሶች' },
  { id: 'b', parentId: 'a', isActive: true, nameAm: 'ባህላዊ' },
  { id: 'c', parentId: 'b', isActive: true, nameAm: 'ነጠላ' },
  { id: 'd', parentId: 'a', isActive: false, nameAm: 'ቀሚስ' },
  { id: 'e', parentId: 'd', isActive: true, nameAm: 'ሌላ' },
];

describe('buildCategoryTree', () => {
  it('nests children under their parents', () => {
    const tree = buildCategoryTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.id)).toEqual(['b']);
    expect(tree[0].children[0].children[0].id).toBe('c');
  });

  it('hides disabled categories and everything under them', () => {
    const ids = JSON.stringify(buildCategoryTree(rows));
    expect(ids).not.toContain('"id":"d"');
    expect(ids).not.toContain('"id":"e"');
  });

  it('includes disabled categories when asked', () => {
    const tree = buildCategoryTree(rows, true);
    expect(tree[0].children.map((c) => c.id)).toEqual(['b', 'd']);
  });
});
