open Types

type call_target = { name : string; file : string option }

type call_target_state =
  | No_call_target
  | Call_target_file of string
  | Call_target_function of call_target

type pending_call = { count : cost; target : call_target option }
type declared_cost_kind = Summary_costs | Total_costs

type part = {
  event_indices : int list option;
  observed_costs : cost list;
  summary_costs : cost list option;
  totals_costs : cost list option;
}

type state = {
  functions : (int, function_node) Hashtbl.t;
  function_by_name : (string, int) Hashtbl.t;
  mutable edges : call_edge list;
  self_costs : (int, cost list) Hashtbl.t;
  line_costs : (int, (int, cost list) Hashtbl.t) Hashtbl.t;
  call_counts : (int, cost) Hashtbl.t;
  mutable next_id : int;
  mutable current_file : string;
  mutable current_function_name : string;
  mutable current_function_id : int;
  mutable call_target : call_target_state;
  mutable pending_call : pending_call option;
  mutable event_types : string list;
  mutable total_costs : cost list;
  mutable current_part : part option;
}

let make_state () =
  {
    functions = Hashtbl.create 256;
    function_by_name = Hashtbl.create 256;
    edges = [];
    self_costs = Hashtbl.create 256;
    line_costs = Hashtbl.create 256;
    call_counts = Hashtbl.create 256;
    next_id = 1;
    current_file = "";
    current_function_name = "";
    current_function_id = 0;
    call_target = No_call_target;
    pending_call = None;
    event_types = [];
    total_costs = [];
    current_part = None;
  }

let clean_name name = if name = "???" || name = "" then "(unknown)" else name

let rec take count values =
  match (count, values) with
  | 0, _ | _, [] -> []
  | count, value :: rest -> value :: take (count - 1) rest

let rec zeros count =
  if count <= 0 then [] else Counter.zero :: zeros (count - 1)

let pad_costs costs length =
  let retained = take length costs in
  retained @ zeros (length - List.length retained)

let add_costs left right =
  let length = max (List.length left) (List.length right) in
  List.map2 Counter.add (pad_costs left length) (pad_costs right length)

let first_cost = function cost :: _ -> cost | [] -> Counter.zero

let find_event_index events target =
  let rec find index = function
    | [] -> None
    | event :: _ when event = target -> Some index
    | _ :: rest -> find (index + 1) rest
  in
  find 0 events

let empty_part metric_count =
  {
    event_indices = None;
    observed_costs = zeros metric_count;
    summary_costs = None;
    totals_costs = None;
  }

let get_or_start_part state =
  match state.current_part with
  | Some part -> part
  | None ->
      let part = empty_part (List.length state.event_types) in
      state.current_part <- Some part;
      part

let resize_part length part =
  {
    part with
    observed_costs = pad_costs part.observed_costs length;
    summary_costs =
      Option.map (fun costs -> pad_costs costs length) part.summary_costs;
    totals_costs =
      Option.map (fun costs -> pad_costs costs length) part.totals_costs;
  }

let resize_cost_vectors state length =
  let self_entries =
    Hashtbl.fold
      (fun id costs entries -> (id, costs) :: entries)
      state.self_costs []
  in
  List.iter
    (fun (id, costs) ->
      Hashtbl.replace state.self_costs id (pad_costs costs length))
    self_entries;
  Hashtbl.iter
    (fun _ line_table ->
      let line_entries =
        Hashtbl.fold
          (fun line costs entries -> (line, costs) :: entries)
          line_table []
      in
      List.iter
        (fun (line, costs) ->
          Hashtbl.replace line_table line (pad_costs costs length))
        line_entries)
    state.line_costs;
  state.edges <-
    List.map
      (fun (edge : call_edge) ->
        let inclusive_costs = pad_costs edge.inclusive_costs length in
        { edge with inclusive_costs; inclusive = first_cost inclusive_costs })
      state.edges;
  state.total_costs <- pad_costs state.total_costs length;
  state.current_part <- Option.map (resize_part length) state.current_part

let ensure_global_event state event =
  match find_event_index state.event_types event with
  | Some index -> index
  | None ->
      state.event_types <- state.event_types @ [ event ];
      let length = List.length state.event_types in
      resize_cost_vectors state length;
      length - 1

let finalize_part state =
  match state.current_part with
  | None -> ()
  | Some part ->
      let length = List.length state.event_types in
      let part_costs =
        match (part.totals_costs, part.summary_costs) with
        | Some costs, _ -> costs
        | None, Some costs -> costs
        | None, None -> part.observed_costs
      in
      state.total_costs <-
        add_costs state.total_costs (pad_costs part_costs length);
      state.current_part <- None

let start_part state =
  finalize_part state;
  state.current_part <- Some (empty_part (List.length state.event_types))

let set_events state events =
  let already_has_events =
    match state.current_part with
    | Some { event_indices = Some _; _ } -> true
    | _ -> false
  in
  if already_has_events then finalize_part state;
  ignore (get_or_start_part state);
  let events = if events = [] then [ "Time" ] else events in
  let event_indices = List.map (ensure_global_event state) events in
  let part = get_or_start_part state in
  state.current_part <-
    Some
      {
        part with
        event_indices = Some event_indices;
        observed_costs = zeros (List.length state.event_types);
      }

let ensure_current_events state =
  match state.current_part with
  | Some { event_indices = Some indices; _ } -> indices
  | None | Some { event_indices = None; _ } ->
      ignore (get_or_start_part state);
      let index = ensure_global_event state "Time" in
      let part = get_or_start_part state in
      state.current_part <-
        Some
          {
            part with
            event_indices = Some [ index ];
            observed_costs =
              pad_costs part.observed_costs (List.length state.event_types);
          };
      [ index ]

let map_current_costs state costs =
  let event_indices = ensure_current_events state in
  let local_costs = pad_costs costs (List.length event_indices) in
  let mapped = Array.make (List.length state.event_types) Counter.zero in
  List.iter2
    (fun index value -> mapped.(index) <- Counter.add mapped.(index) value)
    event_indices local_costs;
  Array.to_list mapped

let get_or_create_fn state name file =
  ignore (ensure_current_events state);
  let key = file ^ "::" ^ name in
  match Hashtbl.find_opt state.function_by_name key with
  | Some id -> id
  | None ->
      let id = state.next_id in
      state.next_id <- state.next_id + 1;
      Hashtbl.add state.function_by_name key id;
      Hashtbl.add state.functions id
        { id; name = clean_name name; file = clean_name file; line = 0 };
      Hashtbl.add state.self_costs id (zeros (List.length state.event_types));
      Hashtbl.add state.call_counts id Counter.zero;
      id

let cancel_pending_call state = state.pending_call <- None
let clear_call_target state = state.call_target <- No_call_target

let record_declared_costs state kind costs =
  let mapped_costs = map_current_costs state costs in
  let part = get_or_start_part state in
  state.current_part <-
    Some
      (match kind with
      | Summary_costs -> { part with summary_costs = Some mapped_costs }
      | Total_costs -> { part with totals_costs = Some mapped_costs })

let record_self_cost state line costs =
  if state.current_function_id <> 0 then begin
    let mapped_costs = map_current_costs state costs in
    let metric_count = List.length state.event_types in
    let current =
      Option.value
        (Hashtbl.find_opt state.self_costs state.current_function_id)
        ~default:(zeros metric_count)
    in
    Hashtbl.replace state.self_costs state.current_function_id
      (add_costs current mapped_costs);
    let line_table =
      match Hashtbl.find_opt state.line_costs state.current_function_id with
      | Some table -> table
      | None ->
          let table = Hashtbl.create 32 in
          Hashtbl.add state.line_costs state.current_function_id table;
          table
    in
    let existing =
      Option.value
        (Hashtbl.find_opt line_table line)
        ~default:(zeros metric_count)
    in
    Hashtbl.replace line_table line (add_costs existing mapped_costs);
    let part = get_or_start_part state in
    state.current_part <-
      Some
        {
          part with
          observed_costs = add_costs part.observed_costs mapped_costs;
        };
    match Hashtbl.find_opt state.functions state.current_function_id with
    | Some fn when line > 0 && (fn.line = 0 || fn.line > line) ->
        Hashtbl.replace state.functions state.current_function_id
          { fn with line }
    | _ -> ()
  end

let record_call_cost state pending line costs =
  let mapped_costs = map_current_costs state costs in
  begin match (state.current_function_id, pending.target) with
  | 0, _ | _, None -> ()
  | caller_id, Some target ->
      let called_file = Option.value target.file ~default:state.current_file in
      let callee_id = get_or_create_fn state target.name called_file in
      state.edges <-
        {
          caller_id;
          callee_id;
          calls = pending.count;
          callsite_line = line;
          inclusive = first_cost mapped_costs;
          exclusive = Counter.zero;
          inclusive_costs = mapped_costs;
        }
        :: state.edges;
      let previous_count =
        Option.value
          (Hashtbl.find_opt state.call_counts callee_id)
          ~default:Counter.zero
      in
      Hashtbl.replace state.call_counts callee_id
        (Counter.add previous_count pending.count)
  end;
  cancel_pending_call state;
  clear_call_target state

let update_called_file state path =
  state.call_target <-
    (match state.call_target with
    | Call_target_function target ->
        Call_target_function { target with file = Some path }
    | No_call_target | Call_target_file _ -> Call_target_file path)

let update_called_function state name =
  let file =
    match state.call_target with
    | Call_target_file path -> Some path
    | Call_target_function target -> target.file
    | No_call_target -> None
  in
  state.call_target <- Call_target_function { name; file }

let pending_target state =
  match state.call_target with
  | Call_target_function target -> Some target
  | No_call_target | Call_target_file _ -> None

let interpret state token =
  match token with
  | Empty | Comment -> ()
  | Invalid ->
      cancel_pending_call state;
      clear_call_target state
  | Header _ | Positions _ | Object -> cancel_pending_call state
  | Part ->
      cancel_pending_call state;
      clear_call_target state;
      start_part state
  | Events events ->
      cancel_pending_call state;
      clear_call_target state;
      set_events state events
  | Summary costs ->
      cancel_pending_call state;
      clear_call_target state;
      record_declared_costs state Summary_costs costs
  | Totals costs ->
      cancel_pending_call state;
      clear_call_target state;
      record_declared_costs state Total_costs costs
  | File path ->
      cancel_pending_call state;
      clear_call_target state;
      state.current_file <- path
  | Function name ->
      cancel_pending_call state;
      clear_call_target state;
      state.current_function_name <- name;
      state.current_function_id <-
        get_or_create_fn state name state.current_file
  | CalledFile path ->
      cancel_pending_call state;
      update_called_file state path
  | CalledFunction name ->
      cancel_pending_call state;
      update_called_function state name
  | Calls { count; target_line = _ } ->
      cancel_pending_call state;
      state.pending_call <- Some { count; target = pending_target state }
  | Cost { line; costs } -> begin
      match state.pending_call with
      | Some pending -> record_call_cost state pending line costs
      | None -> record_self_cost state line costs
    end

let add_indexed_edge table id edge =
  let edges = Option.value (Hashtbl.find_opt table id) ~default:[] in
  Hashtbl.replace table id (edge :: edges)

let build_stats state : (int * function_stats) list =
  let out_edges = Hashtbl.create 256 in
  let in_edges = Hashtbl.create 256 in
  List.iter
    (fun (edge : call_edge) ->
      add_indexed_edge out_edges edge.caller_id edge;
      add_indexed_edge in_edges edge.callee_id edge)
    state.edges;
  let metric_count = List.length state.event_types in
  let stats : (int, function_stats) Hashtbl.t = Hashtbl.create 256 in
  Hashtbl.iter
    (fun id (fn : function_node) ->
      let incoming = Option.value (Hashtbl.find_opt in_edges id) ~default:[] in
      let outgoing = Option.value (Hashtbl.find_opt out_edges id) ~default:[] in
      let callers = List.map (fun edge -> edge.caller_id) incoming in
      let callees = List.map (fun edge -> edge.callee_id) outgoing in
      let self_costs =
        Option.value
          (Hashtbl.find_opt state.self_costs id)
          ~default:(zeros metric_count)
      in
      let line_costs =
        match Hashtbl.find_opt state.line_costs id with
        | None -> []
        | Some lookup ->
            Hashtbl.fold
              (fun line costs entries -> (line, costs) :: entries)
              lookup []
            |> List.sort (fun (left, _) (right, _) -> Stdlib.compare left right)
      in
      let calls =
        Hashtbl.find_opt state.call_counts id
        |> Option.value ~default:Counter.one
        |> Counter.max Counter.one
      in
      Hashtbl.add stats id
        {
          id;
          name = fn.name;
          file = fn.file;
          line = fn.line;
          self_cost = first_cost self_costs;
          total_cost = Counter.zero;
          self_costs;
          total_costs = zeros metric_count;
          line_costs;
          calls;
          callers = List.sort_uniq Stdlib.compare callers;
          callees = List.sort_uniq Stdlib.compare callees;
        })
    state.functions;
  let stat_ids = Hashtbl.fold (fun id _ ids -> id :: ids) stats [] in
  List.iter
    (fun id ->
      match Hashtbl.find_opt stats id with
      | None -> ()
      | Some stats_for_function ->
          let edges =
            Option.value (Hashtbl.find_opt out_edges id) ~default:[]
          in
          let total_costs =
            List.fold_left
              (fun totals edge -> add_costs totals edge.inclusive_costs)
              stats_for_function.self_costs edges
          in
          Hashtbl.replace stats id
            {
              stats_for_function with
              total_costs;
              total_cost = first_cost total_costs;
            })
    stat_ids;
  Hashtbl.fold
    (fun id function_stats entries -> (id, function_stats) :: entries)
    stats []

let function_count state = Hashtbl.length state.functions
let current_function state = state.current_function_name

let finish state =
  if state.event_types = [] then ignore (ensure_global_event state "Time");
  finalize_part state;
  let stats = build_stats state in
  let functions =
    Hashtbl.fold (fun id fn entries -> (id, fn) :: entries) state.functions []
  in
  {
    functions;
    edges = state.edges;
    stats;
    total_cost = first_cost state.total_costs;
    event_type =
      (match state.event_types with event :: _ -> event | [] -> "Time");
    event_types = state.event_types;
    total_costs = state.total_costs;
  }
