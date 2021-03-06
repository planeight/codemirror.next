import {EditorState, Transaction, StateField, StateExtension} from "../../state/src"
import {combineConfig, Slot} from "../../extension/src/extension"
import {HistoryState, ItemFilter, PopTarget} from "./core"

const historyStateSlot = Slot.define<HistoryState>()
export const closeHistorySlot = Slot.define<boolean>()

interface CompleteHistoryConfig {minDepth: number, newGroupDelay: number}

function historyField({minDepth, newGroupDelay}: CompleteHistoryConfig) {
  return new StateField({
    init(editorState: EditorState): HistoryState {
      return HistoryState.empty
    },

    apply(tr: Transaction, state: HistoryState, editorState: EditorState): HistoryState {
      const fromMeta = tr.getMeta(historyStateSlot)
      if (fromMeta) return fromMeta
      if (tr.getMeta(closeHistorySlot)) state = state.resetTime()
      if (!tr.changes.length && !tr.selectionSet) return state

      if (tr.getMeta(Transaction.addToHistory) !== false)
        return state.addChanges(tr.changes, tr.changes.length ? tr.invertedChanges() : null,
                                tr.startState.selection, tr.getMeta(Transaction.time)!,
                                tr.getMeta(Transaction.userEvent), newGroupDelay, minDepth)
      return state.addMapping(tr.changes.desc, minDepth)
    }
  })
}

export type HistoryConfig = Partial<CompleteHistoryConfig>

class HistoryContext {
  constructor(public field: StateField<HistoryState>, public config: CompleteHistoryConfig) {}
}

const historyBehavior = StateExtension.defineBehavior<HistoryContext>()

export const history = StateExtension.unique<HistoryConfig>(configs => {
  let config = combineConfig(configs, {
    minDepth: 100,
    newGroupDelay: 500
  }, {minDepth: Math.max})
  let field = historyField(config)
  return StateExtension.all(
    field.extension,
    historyBehavior(new HistoryContext(field, config))
  )
}, {})

function cmd(target: PopTarget, only: ItemFilter) {
  return function({state, dispatch}: {state: EditorState, dispatch: (tr: Transaction) => void}) {
    let hist = state.behavior.get(historyBehavior)
    if (!hist.length) return false
    let {field, config} = hist[0]
    let historyState = state.getField(field)
    if (!historyState.canPop(target, only)) return false
    const {transaction, state: newState} = historyState.pop(target, only, state.transaction, config.minDepth)
    dispatch(transaction.addMeta(historyStateSlot(newState)))
    return true
  }
}

export const undo = cmd(PopTarget.Done, ItemFilter.OnlyChanges)
export const redo = cmd(PopTarget.Undone, ItemFilter.OnlyChanges)
export const undoSelection = cmd(PopTarget.Done, ItemFilter.Any)
export const redoSelection = cmd(PopTarget.Undone, ItemFilter.Any)

// Set a flag on the given transaction that will prevent further steps
// from being appended to an existing history event (so that they
// require a separate undo command to undo).
export function closeHistory(tr: Transaction): Transaction {
  return tr.addMeta(closeHistorySlot(true))
}

function depth(target: PopTarget, only: ItemFilter) {
  return function(state: EditorState): number {
    let hist = state.behavior.get(historyBehavior)
    if (hist.length == 0) return 0
    let {field} = hist[0]
    return state.getField(field).eventCount(target, only)
  }
}

// The amount of undoable change events available in a given state.
export const undoDepth = depth(PopTarget.Done, ItemFilter.OnlyChanges)
// The amount of redoable change events available in a given state.
export const redoDepth = depth(PopTarget.Undone, ItemFilter.OnlyChanges)
// The amount of undoable events available in a given state.
export const redoSelectionDepth = depth(PopTarget.Done, ItemFilter.Any)
// The amount of redoable events available in a given state.
export const undoSelectionDepth = depth(PopTarget.Undone, ItemFilter.Any)
