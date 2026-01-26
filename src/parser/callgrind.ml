open Types
open Parser
open Lexer

let function_node_to_js (fn : function_node) : Js.Json.t =
  Js.Json.object_ (Js.Dict.fromList [
    ("id", Js.Json.number (float_of_int fn.id));
    ("name", Js.Json.string fn.name);
    ("file", Js.Json.string fn.file);
    ("line", Js.Json.number (float_of_int fn.line));
  ])

let call_edge_to_js (e : call_edge) : Js.Json.t =
  Js.Json.object_ (Js.Dict.fromList [
    ("callerId", Js.Json.number (float_of_int e.caller_id));
    ("calleeId", Js.Json.number (float_of_int e.callee_id));
    ("calls", Js.Json.number (float_of_int e.calls));
    ("inclusive", Js.Json.number (float_of_int e.inclusive));
    ("exclusive", Js.Json.number (float_of_int e.exclusive));
    ("inclusiveCosts", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) e.inclusive_costs)));
  ])

let function_stats_to_js (s : function_stats) : Js.Json.t =
  Js.Json.object_ (Js.Dict.fromList [
    ("id", Js.Json.number (float_of_int s.id));
    ("name", Js.Json.string s.name);
    ("file", Js.Json.string s.file);
    ("line", Js.Json.number (float_of_int s.line));
    ("selfCost", Js.Json.number (float_of_int s.self_cost));
    ("totalCost", Js.Json.number (float_of_int s.total_cost));
    ("selfCosts", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) s.self_costs)));
    ("totalCosts", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) s.total_costs)));
    ("calls", Js.Json.number (float_of_int s.calls));
    ("callers", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) s.callers)));
    ("callees", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) s.callees)));
  ])

let profile_data_to_js (data : profile_data) : Js.Json.t =
  Js.Json.object_ (Js.Dict.fromList [
    ("functions", Js.Json.array (Array.of_list (List.map (fun (id, fn) ->
      Js.Json.array [| Js.Json.number (float_of_int id); function_node_to_js fn |]
    ) data.functions)));
    ("edges", Js.Json.array (Array.of_list (List.map call_edge_to_js data.edges)));
    ("stats", Js.Json.array (Array.of_list (List.map (fun (id, s) ->
      Js.Json.array [| Js.Json.number (float_of_int id); function_stats_to_js s |]
    ) data.stats)));
    ("totalCost", Js.Json.number (float_of_int data.total_cost));
    ("eventType", Js.Json.string data.event_type);
    ("eventTypes", Js.Json.array (Array.of_list (List.map Js.Json.string data.event_types)));
    ("totalCosts", Js.Json.array (Array.of_list (List.map (fun x -> Js.Json.number (float_of_int x)) data.total_costs)));
  ])

let parse_content content on_progress =
  let state = make_state () in
  let lines = String.split_on_char '\n' content in
  let total_lines = List.length lines in
  let line_number = ref 0 in
  let last_percent = ref (-1) in

  List.iter (fun line ->
    incr line_number;
    let percent = (!line_number * 100) / total_lines in
    if percent <> !last_percent then begin
      last_percent := percent;
      on_progress percent (Hashtbl.length state.functions) state.current_function
    end;
    let token = lex_line line state.file_compression state.func_compression in
    interpret state token !line_number
  ) lines;

  let stats = build_stats state in
  let functions = Hashtbl.fold (fun id fn acc -> (id, fn) :: acc) state.functions [] in

  {
    functions;
    edges = state.edges;
    stats;
    total_cost = (match state.total_costs with x :: _ -> x | [] -> 0);
    event_type = (match state.event_types with x :: _ -> x | [] -> "Time");
    event_types = state.event_types;
    total_costs = state.total_costs;
  }

let parseCallgrindContent content on_progress =
  let progress_fn percent fn_count current_fn =
    on_progress percent fn_count current_fn
  in
  let result = parse_content content progress_fn in
  profile_data_to_js result
