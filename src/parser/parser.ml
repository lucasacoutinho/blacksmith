open Types

type state = {
  mutable functions: (int, function_node) Hashtbl.t;
  mutable function_by_name: (string, int) Hashtbl.t;
  mutable edges: call_edge list;
  mutable self_costs: (int, int list) Hashtbl.t;
  mutable line_costs: (int, (int, int list) Hashtbl.t) Hashtbl.t;
  mutable call_counts: (int, int) Hashtbl.t;
  mutable next_id: int;
  mutable current_file: string;
  mutable current_function: string;
  mutable current_function_id: int;
  mutable called_file: string;
  mutable called_function: string;
  mutable pending_call_count: int;
  mutable pending_call_line: int;
  mutable event_types: string list;
  mutable total_costs: int list;
  file_compression: (int, string) Hashtbl.t;
  func_compression: (int, string) Hashtbl.t;
}

let make_state () = {
  functions = Hashtbl.create 256;
  function_by_name = Hashtbl.create 256;
  edges = [];
  self_costs = Hashtbl.create 256;
  line_costs = Hashtbl.create 256;
  call_counts = Hashtbl.create 256;
  next_id = 1;
  current_file = "";
  current_function = "";
  current_function_id = 0;
  called_file = "";
  called_function = "";
  pending_call_count = 0;
  pending_call_line = 0;
  event_types = ["Time"];
  total_costs = [0];
  file_compression = Hashtbl.create 64;
  func_compression = Hashtbl.create 64;
}

let clean_name name =
  if name = "???" || name = "" then "(unknown)" else name

let get_or_create_fn state name file =
  let key = file ^ "::" ^ name in
  try Hashtbl.find state.function_by_name key
  with Not_found ->
    let id = state.next_id in
    state.next_id <- state.next_id + 1;
    Hashtbl.add state.function_by_name key id;
    Hashtbl.add state.functions id {
      id;
      name = clean_name name;
      file = clean_name file;
      line = 0;
    };
    let num_metrics = List.length state.event_types in
    Hashtbl.add state.self_costs id (List.init num_metrics (fun _ -> 0));
    Hashtbl.add state.call_counts id 0;
    id

let pad_costs costs len =
  let rec pad lst n =
    if n <= 0 then lst
    else pad (lst @ [0]) (n - 1)
  in
  let current_len = List.length costs in
  if current_len >= len then
    let rec take n lst = match n, lst with
      | 0, _ | _, [] -> []
      | n, x :: xs -> x :: take (n - 1) xs
    in take len costs
  else pad costs (len - current_len)

let interpret state token line_number =
  match token with
  | Empty | Comment | Header _ | Object -> ()
  | Events types ->
      state.event_types <- types;
      state.total_costs <- List.init (List.length types) (fun _ -> 0)
  | File path ->
      state.current_file <- path
  | Function name ->
      state.current_function <- name;
      state.current_function_id <- get_or_create_fn state name state.current_file;
      let fn = Hashtbl.find state.functions state.current_function_id in
      if fn.line = 0 then
        Hashtbl.replace state.functions state.current_function_id { fn with line = line_number }
  | CalledFile path ->
      state.called_file <- path
  | CalledFunction name ->
      state.called_function <- name
  | Calls { count; line } ->
      state.pending_call_count <- count;
      state.pending_call_line <- line
  | Cost { line; costs } ->
      let num_metrics = List.length state.event_types in
      let padded_costs = pad_costs costs num_metrics in
      if state.pending_call_count > 0 && state.called_function <> "" then begin
        let called_file = if state.called_file = "" then state.current_file else state.called_file in
        let callee_id = get_or_create_fn state state.called_function called_file in
        state.edges <- {
          caller_id = state.current_function_id;
          callee_id;
          calls = state.pending_call_count;
          callsite_line = if state.pending_call_line > 0 then state.pending_call_line else line;
          inclusive = (match padded_costs with x :: _ -> x | [] -> 0);
          exclusive = 0;
          inclusive_costs = padded_costs;
        } :: state.edges;
        let prev_count = try Hashtbl.find state.call_counts callee_id with Not_found -> 0 in
        Hashtbl.replace state.call_counts callee_id (prev_count + state.pending_call_count);
        state.pending_call_count <- 0;
        state.pending_call_line <- 0;
        state.called_function <- "";
        state.called_file <- ""
      end else begin
        let current = try Hashtbl.find state.self_costs state.current_function_id
          with Not_found -> List.init num_metrics (fun _ -> 0) in
        let updated = List.map2 (+) current padded_costs in
        Hashtbl.replace state.self_costs state.current_function_id updated;
        let line_costs = try Hashtbl.find state.line_costs state.current_function_id
          with Not_found ->
            let tbl = Hashtbl.create 32 in
            Hashtbl.add state.line_costs state.current_function_id tbl;
            tbl
        in
        let existing = try Hashtbl.find line_costs line
          with Not_found -> List.init num_metrics (fun _ -> 0) in
        let updated_line_costs = List.map2 (+) existing padded_costs in
        Hashtbl.replace line_costs line updated_line_costs;
        state.total_costs <- List.map2 (+) state.total_costs padded_costs;
        let fn = Hashtbl.find state.functions state.current_function_id in
        if fn.line = 0 || fn.line > line then
          Hashtbl.replace state.functions state.current_function_id { fn with line }
      end

let build_stats state : (int * function_stats) list =
  let out_edges = Hashtbl.create 256 in
  List.iter (fun e ->
    let lst = try Hashtbl.find out_edges e.caller_id with Not_found -> [] in
    Hashtbl.replace out_edges e.caller_id (e :: lst)
  ) state.edges;

  let num_metrics = List.length state.event_types in
  let stats : (int, function_stats) Hashtbl.t = Hashtbl.create 256 in

  Hashtbl.iter (fun id (fn : function_node) ->
    let callers = List.filter_map (fun e ->
      if e.callee_id = id then Some e.caller_id else None
    ) state.edges in
    let callees = List.filter_map (fun e ->
      if e.caller_id = id then Some e.callee_id else None
    ) state.edges in
    let self_costs = try Hashtbl.find state.self_costs id
      with Not_found -> List.init num_metrics (fun _ -> 0) in
    let line_costs =
      let lookup = try Hashtbl.find state.line_costs id
        with Not_found -> Hashtbl.create 0
      in
      Hashtbl.fold (fun line costs acc -> (line, costs) :: acc) lookup []
      |> List.sort (fun (a, _) (b, _) -> compare a b)
    in
    let calls = max 1 (try Hashtbl.find state.call_counts id with Not_found -> 1) in
    Hashtbl.add stats id ({
      id;
      name = fn.name;
      file = fn.file;
      line = fn.line;
      self_cost = (match self_costs with x :: _ -> x | [] -> 0);
      total_cost = 0;
      self_costs;
      total_costs = List.init num_metrics (fun _ -> 0);
      line_costs;
      calls;
      callers = List.sort_uniq compare callers;
      callees = List.sort_uniq compare callees;
    } : function_stats)
  ) state.functions;

  let visited = Hashtbl.create 256 in
  let in_stack = Hashtbl.create 256 in

  let compute_inclusive id =
    let s : function_stats = try Hashtbl.find stats id with Not_found ->
      { id; name = ""; file = ""; line = 0; self_cost = 0; total_cost = 0;
        self_costs = []; total_costs = []; line_costs = [];
        calls = 0; callers = []; callees = [] }
    in
    if s.total_cost > 0 then s.total_costs
    else if Hashtbl.mem in_stack id then s.self_costs
    else begin
      Hashtbl.add in_stack id true;
      Hashtbl.add visited id true;
      let edges = try Hashtbl.find out_edges id with Not_found -> [] in
      let totals = List.fold_left (fun acc e ->
        List.map2 (+) acc e.inclusive_costs
      ) s.self_costs edges in
      Hashtbl.replace stats id { s with
        total_costs = totals;
        total_cost = (match totals with x :: _ -> x | [] -> 0)
      };
      Hashtbl.remove in_stack id;
      totals
    end
  in

  Hashtbl.iter (fun id _ ->
    if not (Hashtbl.mem visited id) then ignore (compute_inclusive id)
  ) stats;

  Hashtbl.iter (fun id (s : function_stats) ->
    if s.total_cost = 0 then
      Hashtbl.replace stats id { s with
        total_cost = s.self_cost;
        total_costs = s.self_costs
      }
  ) stats;

  Hashtbl.fold (fun id s acc -> (id, s) :: acc) stats []
