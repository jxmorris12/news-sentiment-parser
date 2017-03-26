
var sourcesURL = "/sources";

$.getJSON(sourcesURL, function(raw)  {
  // console.log(raw);
  drawChart(raw);
});

function drawChart(graphdata) {

  var xAvg = 0, yAvg = 0;

  graphdata.forEach(function(g) {
    g.x = g.sentiment;
    g.y = g.vocab;

    xAvg += g.x || 0;
    yAvg += g.y || 0;
  });

  xAvg /= graphdata.length;
  yAvg /= graphdata.length;

  Highcharts.chart('container', {

      chart: {
          type: 'bubble',
          plotBorderWidth: 1,
          zoomType: 'xy'
      },

      legend: {
          enabled: false
      },

      title: {
          text: 'News sources graphed by language and political leaning. Click and drag to zoom',
           style: {
            'fontSize': '14px'
          }
      },
      xAxis: {
          gridLineWidth: 1,
          title: {
              text: 'Political Leaning'
          },
          labels: {
              format: '{value}'
          },
          plotLines: [{
              color: 'black',
              dashStyle: 'dot',
              width: 2,
              // Get this value from json
              value: xAvg,
              label: {
                  rotation: 0,
                  y: 15,
                  style: {
                      fontStyle: 'italic'
                  },
                  text: 'Avg political leaning'
              },
              zIndex: 3
          }]
      },

      yAxis: {
          startOnTick: false,
          endOnTick: false,
          title: {
              text: 'Language Complexity'
          },
          labels: {
              format: '{value}'
          },
          maxPadding: 0.2,
          plotLines: [{
              color: 'black',
              dashStyle: 'dot',
              width: 2,
              // Get this value from json
              value: yAvg,
              label: {
                  align: 'right',
                  style: {
                      fontStyle: 'italic'
                  },
                  text: 'Language severity',
                  x: -10
              },
              zIndex: 3
          }]
      },

      tooltip: {
          useHTML: true,
          headerFormat: '<table style="text-align: center">',
          pointFormat: 
              '<tr><th colspan="2"><h3>{point.name}</h3></th></tr>' +
              '<img src={point.largeLogoUrl} alt="{point.description}" style="max-width:100px;max-height:80px"/>' +
              '<tr><th>Average Sentiment:</th><td>{point.x}</td></tr>' +
              '<tr><th>Language Severity:</th><td>{point.y}</td></tr>',
          footerFormat: '</table>',
          followPointer: true
      },

      plotOptions: {
          series: {
              dataLabels: {
                  enabled: true,
                  format: '{point.name}'
              },
              allowPointSelect: true,
              point:{
                events:{
                  select: function(e){
                    $('.about-section').css('display', 'block');
                    $('html, body').animate({ scrollTop: $('#about').offset().top }, 'slow', selectSource(this));
                  }
                }
              }
          }
      },
      series: [{
          data: graphdata
      }]
  });
}

function selectSource (point) {

  var clickedSourceId = point.id;
  var articlesUrl = "articles/" + clickedSourceId;

  $('#sourceDetailsHeader').text(point.name);

  console.log('clicked point:', point);

  $.getJSON(articlesUrl, function(raw)  {
    loadBottomGraph(raw, point);
  });

}

function loadBottomGraph(data, pointClicked) {

  var mappedData = data.map(datum => {
      return {
      'name': datum.title,
      'x': datum.sentiment, 
      'y': datum.vocab
    }
  });

  console.log(mappedData);

  var source = pointClicked.source,
           x = pointClicked.x,
           y = pointClicked.y;

   Highcharts.chart('source-detail', {
       chart: {
           type: 'scatter',
           zoomType: 'xy'
       },
       title: {
           text: 'News sources graphed by language and political leaning. Click and drag to zoom',
           style: {
            'fontSize': '14px'
          }
       },
       subtitle: {
           text: 'Source: newsapi.org'
       },
       xAxis: {
           title: {
               enabled: true,
               text: 'Political Leaning'
           },
           startOnTick: true,
           endOnTick: true,
           showLastLabel: true
       },
       yAxis: {
           title: {
               text: 'Language Complexity'
           }
       },
       legend: {
           layout: 'vertical',
           align: 'left',
           verticalAlign: 'top',
           x: 100,
           y: 70,
           floating: true,
           backgroundColor: (Highcharts.theme && Highcharts.theme.legendBackgroundColor) || '#FFFFFF',
           borderWidth: 1
       },
       plotOptions: {
           scatter: {
               marker: {
                   radius: 5,
                   states: {
                       hover: {
                           enabled: true,
                           lineColor: 'rgb(100,100,100)'
                       }
                   }
               },
               states: {
                   hover: {
                       marker: {
                           enabled: false
                       }
                   }
               },
               tooltip: {
                   // headerFormat: '<b>{point.name}</b><br>',
                   pointFormat: '<b>{point.name}</b><br>'
                               +'Average Sentiment: {point.x} <br>' +
                                'Language Severity: {point.y}'
               }
           }
       },
       series: [{
           name: pointClicked.name,
           color: 'rgba(223, 83, 83, .5)',
           data: mappedData
       }]
   });
}