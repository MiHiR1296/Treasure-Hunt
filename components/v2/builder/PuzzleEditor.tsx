'use client';

import type { PuzzleDefinition, QuarterTurn } from '@/lib/engine/puzzles/types';
import { buttonClass, CheckField, Field, inputClass, NumberField, TextField } from './Fields';
import { moveItem, newId } from './model';
import { defaultPuzzle } from './puzzleDefaults';
import AssetField from './AssetField';
export { defaultPuzzle } from './puzzleDefaults';

export const puzzleLabels: Record<PuzzleDefinition['type'], string> = {
  jigsaw: 'Jigsaw tiles', sudoku: 'Sudoku', word_search: 'Word search', crossword: 'Crossword',
  rotation: 'Rotate image tiles', text: 'Text answer', multiple_choice: 'Multiple choice',
  matching: 'Match pairs', sequence: 'Put items in order',
};

export default function PuzzleEditor({ value, onChange }: { value: PuzzleDefinition; onChange: (value: PuzzleDefinition) => void }) {
  return <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
    <Field label="Puzzle type" hint="Changing the type starts a new puzzle configuration."><select className={inputClass} value={value.type} onChange={event => onChange(defaultPuzzle(event.target.value as PuzzleDefinition['type']))}>{Object.entries(puzzleLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></Field>
    {(value.type === 'text' || value.type === 'multiple_choice') && <TextField label="Puzzle question" value={value.prompt} multiline onChange={prompt => onChange({ ...value, prompt })} />}
    {value.type === 'text' && <>
      <TextField label="Accepted answers — one per line" value={value.answers.join('\n')} multiline onChange={text => onChange({ ...value, answers: text.split('\n') })} />
      <CheckField label="Match letter case" checked={value.caseSensitive === true} onChange={caseSensitive => onChange({ ...value, caseSensitive })} />
    </>}
    {value.type === 'multiple_choice' && <>
      {value.options.map((option, index) => <div key={option.id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"><TextField label={`Option ${index + 1}`} value={option.label} onChange={label => onChange({ ...value, options: value.options.map(candidate => candidate.id === option.id ? { ...candidate, label } : candidate) })} /><CheckField label="This is the correct answer" checked={value.correctOptionId === option.id} onChange={checked => { if (checked) onChange({ ...value, correctOptionId: option.id }); }} /><button type="button" className={buttonClass} disabled={value.options.length <= 2} onClick={() => onChange({ ...value, options: value.options.filter(candidate => candidate.id !== option.id), correctOptionId: value.correctOptionId === option.id ? value.options.find(candidate => candidate.id !== option.id)!.id : value.correctOptionId })}>Remove option</button></div>)}
      <button type="button" className={buttonClass} onClick={() => onChange({ ...value, options: [...value.options, { id: newId('option', value.options.map(option => option.id)), label: '' }] })}>Add option</button>
    </>}
    {value.type === 'sudoku' && <>
      <Field label="Grid size"><select className={inputClass} value={value.size} onChange={event => {
        const size = Number(event.target.value) as 4 | 9;
        onChange(size === 4 ? defaultPuzzle('sudoku') : { type: 'sudoku', size, givens: [[5,3,0,0,7,0,0,0,0],[6,0,0,1,9,5,0,0,0],[0,9,8,0,0,0,0,6,0],[8,0,0,0,6,0,0,0,3],[4,0,0,8,0,3,0,0,1],[7,0,0,0,2,0,0,0,6],[0,6,0,0,0,0,2,8,0],[0,0,0,4,1,9,0,0,5],[0,0,0,0,8,0,0,7,9]] });
      }}><option value={4}>4 × 4</option><option value={9}>9 × 9</option></select></Field>
      <p className="text-sm leading-6 text-slate-600">Fill in starting numbers. Leave player cells blank. The puzzle must be solvable.</p>
      <div className="grid max-w-md gap-1" style={{ gridTemplateColumns: `repeat(${value.size}, minmax(0, 1fr))` }}>{value.givens.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <input key={`${rowIndex}:${columnIndex}`} type="number" aria-label={`Starting number, row ${rowIndex + 1}, column ${columnIndex + 1}`} inputMode="numeric" min={1} max={value.size} className="h-11 min-w-0 rounded border border-slate-300 bg-white text-center text-sm" value={cell || ''} onChange={event => onChange({ ...value, givens: value.givens.map((candidateRow, candidateRowIndex) => candidateRowIndex === rowIndex ? candidateRow.map((candidateCell, candidateColumnIndex) => candidateColumnIndex === columnIndex ? Number(event.target.value) : candidateCell) : candidateRow) })} />))}</div>
    </>}
    {value.type === 'word_search' && <>
      <TextField label="Letter grid — one row per line" value={value.grid.map(row => row.join('')).join('\n')} multiline onChange={text => onChange({ ...value, grid: text.split('\n').map(row => Array.from(row.toUpperCase())) })} hint="Each row must have the same number of letters. Place each target word in the grid." />
      <TextField label="Words to find — one per line" value={value.words.join('\n')} multiline onChange={text => onChange({ ...value, words: text.split('\n').map(word => word.toUpperCase()) })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Words required to continue" value={value.minimumWords ?? value.words.length} min={1} max={Math.max(1, value.words.length)} onChange={minimumWords => onChange({ ...value, minimumWords })} />
        <NumberField label="Bonus per extra word" value={value.bonusPerExtraWord ?? 0} min={0} max={100} onChange={bonusPerExtraWord => onChange({ ...value, bonusPerExtraWord })} />
      </div>
      <p className="text-sm leading-6 text-slate-600">Players may continue after the required number. Every additional hidden word can award the configured bonus.</p>
    </>}
    {value.type === 'crossword' && <>
      <div className="grid grid-cols-2 gap-3"><NumberField label="Grid rows" value={value.rows} min={1} max={25} onChange={rows => onChange({ ...value, rows })} /><NumberField label="Grid columns" value={value.columns} min={1} max={25} onChange={columns => onChange({ ...value, columns })} /></div>
      {value.entries.map((entry, index) => <div key={entry.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
        <TextField label={`Clue ${index + 1}`} value={entry.clue} onChange={clue => onChange({ ...value, entries: value.entries.map(candidate => candidate.id === entry.id ? { ...candidate, clue } : candidate) })} />
        <TextField label="Answer" value={entry.answer} onChange={answer => onChange({ ...value, entries: value.entries.map(candidate => candidate.id === entry.id ? { ...candidate, answer: answer.toUpperCase() } : candidate) })} />
        <div className="grid grid-cols-2 gap-3"><NumberField label="Starting row" value={entry.row + 1} min={1} max={value.rows} onChange={row => onChange({ ...value, entries: value.entries.map(candidate => candidate.id === entry.id ? { ...candidate, row: row - 1 } : candidate) })} /><NumberField label="Starting column" value={entry.column + 1} min={1} max={value.columns} onChange={column => onChange({ ...value, entries: value.entries.map(candidate => candidate.id === entry.id ? { ...candidate, column: column - 1 } : candidate) })} /></div>
        <Field label="Direction"><select className={inputClass} value={entry.direction} onChange={event => onChange({ ...value, entries: value.entries.map(candidate => candidate.id === entry.id ? { ...candidate, direction: event.target.value as 'across' | 'down' } : candidate) })}><option value="across">Across</option><option value="down">Down</option></select></Field>
        <button type="button" className={buttonClass} disabled={value.entries.length <= 1} onClick={() => onChange({ ...value, entries: value.entries.filter(candidate => candidate.id !== entry.id) })}>Remove clue</button>
      </div>)}
      <button type="button" className={buttonClass} onClick={() => onChange({ ...value, entries: [...value.entries, { id: newId('word', value.entries.map(entry => entry.id)), clue: '', answer: '', row: 0, column: 0, direction: 'across' }] })}>Add crossword clue</button>
    </>}
    {value.type === 'sequence' && <>
      <p className="text-sm text-slate-600">Arrange these items in the correct order. Players will arrange the shuffled items.</p>
      {value.solution.map((id, index) => <div key={id} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"><TextField label={`Position ${index + 1}`} value={value.items.find(item => item.id === id)?.label || ''} onChange={label => onChange({ ...value, items: value.items.map(item => item.id === id ? { ...item, label } : item) })} /><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={index === 0} onClick={() => onChange({ ...value, solution: moveItem(value.solution, index, -1) })}>Move up</button><button type="button" className={buttonClass} disabled={index === value.solution.length - 1} onClick={() => onChange({ ...value, solution: moveItem(value.solution, index, 1) })}>Move down</button><button type="button" className={buttonClass} disabled={value.items.length <= 2} onClick={() => onChange({ ...value, items: value.items.filter(item => item.id !== id), solution: value.solution.filter(candidate => candidate !== id) })}>Remove</button></div></div>)}
      <button type="button" className={buttonClass} onClick={() => { const id = newId('item', value.items.map(item => item.id)); onChange({ ...value, items: [...value.items, { id, label: '' }], solution: [...value.solution, id] }); }}>Add item</button>
    </>}
    {value.type === 'matching' && <>
      <p className="text-sm text-slate-600">Enter matching pairs. Players see the two sides in a different order.</p>
      {value.left.map((left, index) => {
        const rightId = value.solution.find(pair => pair.leftId === left.id)?.rightId;
        const right = value.right.find(item => item.id === rightId);
        return <div key={left.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"><TextField label={`Pair ${index + 1} — first item`} value={left.label} onChange={label => onChange({ ...value, left: value.left.map(item => item.id === left.id ? { ...item, label } : item) })} /><TextField label="Matching item" value={right?.label || ''} onChange={label => onChange({ ...value, right: value.right.map(item => item.id === rightId ? { ...item, label } : item) })} /><button type="button" className={buttonClass} disabled={value.left.length <= 2} onClick={() => onChange({ ...value, left: value.left.filter(item => item.id !== left.id), right: value.right.filter(item => item.id !== rightId), solution: value.solution.filter(pair => pair.leftId !== left.id) })}>Remove pair</button></div>;
      })}
      <button type="button" className={buttonClass} onClick={() => { const leftId = newId('left', value.left.map(item => item.id)); const rightId = newId('right', value.right.map(item => item.id)); onChange({ ...value, left: [...value.left, { id: leftId, label: '' }], right: [...value.right, { id: rightId, label: '' }], solution: [...value.solution, { leftId, rightId }] }); }}>Add pair</button>
    </>}
    {value.type === 'jigsaw' && <>
      <div className="grid grid-cols-2 gap-3">{(['rows', 'columns'] as const).map(dimension => <NumberField key={dimension} label={`Tile ${dimension}`} value={value[dimension]} min={1} max={8} onChange={number => {
        const size = Math.max(1, Math.min(64, number * (dimension === 'rows' ? value.columns : value.rows)));
        const pieces = value.solution.map(id => value.pieces.find(piece => piece.id === id)).filter((piece): piece is typeof value.pieces[number] => Boolean(piece)).slice(0, size);
        while (pieces.length < size) pieces.push({ id: newId('piece', pieces.map(piece => piece.id)), imageUrl: '', alt: `Tile ${pieces.length + 1}` });
        onChange({ ...value, [dimension]: number, pieces, solution: pieces.map(piece => piece.id) });
      }} />)}</div>
      <p className="text-sm leading-6 text-slate-600">Choose image tiles in their correct positions, reading left to right then top to bottom. To cut one photo automatically, open Media, upload the photo, and choose Use for jigsaw. Changing dimensions keeps existing tiles where possible.</p>
      {value.solution.map((id, index) => {
        const piece = value.pieces.find(candidate => candidate.id === id);
        return piece ? <div key={id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"><AssetField label={`Image at row ${Math.floor(index / value.columns) + 1}, column ${index % value.columns + 1}`} value={piece.imageUrl} onChange={imageUrl => onChange({ ...value, pieces: value.pieces.map(candidate => candidate.id === id ? { ...candidate, imageUrl } : candidate) })} /><TextField label="Image description" value={piece.alt || ''} onChange={alt => onChange({ ...value, pieces: value.pieces.map(candidate => candidate.id === id ? { ...candidate, alt } : candidate) })} /></div> : null;
      })}
    </>}
    {value.type === 'rotation' && <>
      <NumberField label="Grid columns" value={value.columns} min={1} max={8} onChange={columns => onChange({ ...value, columns })} />
      {value.tiles.map((tile, index) => <div key={tile.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3"><AssetField label={`Tile ${index + 1} image URL`} value={tile.imageUrl} onChange={imageUrl => onChange({ ...value, tiles: value.tiles.map(candidate => candidate.id === tile.id ? { ...candidate, imageUrl } : candidate) })} /><TextField label="Image description" value={tile.alt || ''} onChange={alt => onChange({ ...value, tiles: value.tiles.map(candidate => candidate.id === tile.id ? { ...candidate, alt } : candidate) })} /><Field label="Correct clockwise rotation"><select className={inputClass} value={tile.correctRotation} onChange={event => onChange({ ...value, tiles: value.tiles.map(candidate => candidate.id === tile.id ? { ...candidate, correctRotation: Number(event.target.value) as QuarterTurn } : candidate) })}>{[0, 90, 180, 270].map(rotation => <option key={rotation} value={rotation}>{rotation}°</option>)}</select></Field><button type="button" className={buttonClass} disabled={value.tiles.length <= 1} onClick={() => onChange({ ...value, tiles: value.tiles.filter(candidate => candidate.id !== tile.id) })}>Remove tile</button></div>)}
      <button type="button" className={buttonClass} onClick={() => onChange({ ...value, tiles: [...value.tiles, { id: newId('tile', value.tiles.map(tile => tile.id)), imageUrl: '', alt: '', correctRotation: 0 }] })}>Add tile</button>
    </>}
  </div>;
}
