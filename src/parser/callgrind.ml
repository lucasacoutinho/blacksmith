open Types

let cost_to_js cost = Js.Json.string (Counter.to_string cost)

let function_node_to_js (fn : function_node) : Js.Json.t =
  Js.Json.object_
    (Js.Dict.fromList
       [
         ("id", Js.Json.number (float_of_int fn.id));
         ("name", Js.Json.string fn.name);
         ("file", Js.Json.string fn.file);
         ("line", Js.Json.number (float_of_int fn.line));
       ])

let call_edge_to_js (e : call_edge) : Js.Json.t =
  Js.Json.object_
    (Js.Dict.fromList
       [
         ("callerId", Js.Json.number (float_of_int e.caller_id));
         ("calleeId", Js.Json.number (float_of_int e.callee_id));
         ("calls", cost_to_js e.calls);
         ("callsiteLine", Js.Json.number (float_of_int e.callsite_line));
         ("inclusive", cost_to_js e.inclusive);
         ("exclusive", cost_to_js e.exclusive);
         ( "inclusiveCosts",
           Js.Json.array (Array.of_list (List.map cost_to_js e.inclusive_costs))
         );
       ])

let function_stats_to_js (s : function_stats) : Js.Json.t =
  Js.Json.object_
    (Js.Dict.fromList
       [
         ("id", Js.Json.number (float_of_int s.id));
         ("name", Js.Json.string s.name);
         ("file", Js.Json.string s.file);
         ("line", Js.Json.number (float_of_int s.line));
         ("selfCost", cost_to_js s.self_cost);
         ("totalCost", cost_to_js s.total_cost);
         ( "selfCosts",
           Js.Json.array (Array.of_list (List.map cost_to_js s.self_costs)) );
         ( "totalCosts",
           Js.Json.array (Array.of_list (List.map cost_to_js s.total_costs)) );
         ( "lineCosts",
           Js.Json.array
             (Array.of_list
                (List.map
                   (fun (line, costs) ->
                     Js.Json.object_
                       (Js.Dict.fromList
                          [
                            ("line", Js.Json.number (float_of_int line));
                            ( "costs",
                              Js.Json.array
                                (Array.of_list (List.map cost_to_js costs)) );
                          ]))
                   s.line_costs)) );
         ("calls", cost_to_js s.calls);
         ( "callers",
           Js.Json.array
             (Array.of_list
                (List.map (fun x -> Js.Json.number (float_of_int x)) s.callers))
         );
         ( "callees",
           Js.Json.array
             (Array.of_list
                (List.map (fun x -> Js.Json.number (float_of_int x)) s.callees))
         );
       ])

let profile_data_to_js (data : profile_data) : Js.Json.t =
  Js.Json.object_
    (Js.Dict.fromList
       [
         ( "functions",
           Js.Json.array
             (Array.of_list
                (List.map
                   (fun (id, fn) ->
                     Js.Json.array
                       [|
                         Js.Json.number (float_of_int id);
                         function_node_to_js fn;
                       |])
                   data.functions)) );
         ( "edges",
           Js.Json.array (Array.of_list (List.map call_edge_to_js data.edges))
         );
         ( "stats",
           Js.Json.array
             (Array.of_list
                (List.map
                   (fun (id, s) ->
                     Js.Json.array
                       [|
                         Js.Json.number (float_of_int id);
                         function_stats_to_js s;
                       |])
                   data.stats)) );
         ("totalCost", cost_to_js data.total_cost);
         ("eventType", Js.Json.string data.event_type);
         ( "eventTypes",
           Js.Json.array
             (Array.of_list (List.map Js.Json.string data.event_types)) );
         ( "totalCosts",
           Js.Json.array (Array.of_list (List.map cost_to_js data.total_costs))
         );
       ])

let count_lines content =
  let length = String.length content in
  let rec count index lines =
    if index >= length then lines
    else if content.[index] = '\n' then count (index + 1) (lines + 1)
    else count (index + 1) lines
  in
  count 0 1

let iter_lines content callback =
  let length = String.length content in
  let rec scan line_start index =
    if index >= length then
      callback (Js.String.slice ~start:line_start ~end_:length content)
    else if content.[index] = '\n' then begin
      callback (Js.String.slice ~start:line_start ~end_:index content);
      scan (index + 1) (index + 1)
    end
    else scan line_start (index + 1)
  in
  scan 0 0

let parse_content content on_progress =
  let state = Parser.make_state () in
  let lexer_state = Lexer.make_state () in
  let total_lines = count_lines content in
  let line_number = ref 0 in
  let last_percent = ref (-1) in

  iter_lines content (fun line ->
      incr line_number;
      let percent = !line_number * 100 / total_lines in
      if percent <> !last_percent then begin
        last_percent := percent;
        on_progress percent
          (Parser.function_count state)
          (Parser.current_function state)
      end;
      let token = Lexer.lex_line lexer_state line in
      Parser.interpret state token);

  Parser.finish state

let parse content on_progress =
  let progress_fn percent fn_count current_fn =
    on_progress percent fn_count current_fn
  in
  let result = parse_content content progress_fn in
  profile_data_to_js result
